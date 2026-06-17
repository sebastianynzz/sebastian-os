import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ORDER_STATUSES,
  portalCreateOrderSchema,
  type CreateOrderInput,
} from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { createOrder } from "../../services/orders.js";
import {
  addDays,
  bogotaUtcRange,
  eachDay,
  todayBogota,
} from "../../services/dailyMetrics.js";
import {
  clientGreenReport,
  currentMonth,
  MONTH_RE,
} from "../../services/greenReport.js";
import { publicTrackingUrl } from "../../services/notifications.js";
import {
  geocodeAddress,
  normalizeAddress,
  LOW_CONFIDENCE_THRESHOLD,
} from "../../services/geocoding.js";
import { checkServiceability } from "../../services/zones.js";
import { logOrderEvent } from "../../services/orderEvents.js";
import { emitOrderUpdate } from "../../services/realtime.js";

/** Campos del pedido que el portal expone (sin datos internos de la operación). */
const portalOrderSelect = {
  id: true,
  trackingNumber: true,
  trackingToken: true,
  externalRef: true,
  customerName: true,
  customerPhone: true,
  addressRaw: true,
  addressNotes: true,
  pickupAddressRaw: true,
  pickedUpAt: true,
  status: true,
  weightKg: true,
  failureReason: true,
  deliveredAt: true,
  recoveryStatus: true,
  rescheduledFromId: true,
  createdAt: true,
} as const;

function withTrackingUrl<T extends { trackingToken: string | null }>(order: T) {
  return { ...order, trackingUrl: publicTrackingUrl(order.trackingToken) };
}

/**
 * Portal del negocio cliente (rol CLIENT). El negocio B2B del tenant entra
 * con su propio usuario, crea envíos (con recogida en su dirección registrada)
 * y los sigue — sin ver nada del resto de la operación: ni otros clientes, ni
 * conductores, ni flota. Núcleo, no requiere módulo de pago.
 */
export default async function portalRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticateClient);

  /** Identidad del portal: el negocio y su operador logístico. */
  app.get("/me", async (request) => {
    const client = await prisma.client.findUniqueOrThrow({
      where: { id: request.user.clientId },
      select: {
        id: true,
        name: true,
        contactName: true,
        pickupAddressRaw: true,
        pickupNotes: true,
        tenant: { select: { name: true, city: true } },
      },
    });
    return client;
  });

  app.get("/orders", async (request) => {
    const query = z
      .object({
        status: z.enum(ORDER_STATUSES).optional(),
        take: z.coerce.number().int().min(1).max(500).default(200),
      })
      .parse(request.query);

    const orders = await prisma.order.findMany({
      where: {
        tenantId: request.user.tenantId,
        clientId: request.user.clientId,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: query.take,
      select: portalOrderSelect,
    });
    return orders.map(withTrackingUrl);
  });

  app.get("/orders/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const order = await prisma.order.findFirst({
      where: {
        id,
        tenantId: request.user.tenantId,
        clientId: request.user.clientId,
      },
      select: {
        ...portalOrderSelect,
        events: {
          orderBy: { createdAt: "asc" },
          select: { type: true, details: true, createdAt: true },
        },
      },
    });
    if (!order) return reply.code(404).send({ error: "Envío no encontrado" });
    return withTrackingUrl(order);
  });

  /** El negocio crea su propio envío; la recogida sale de su dirección registrada. */
  app.post("/orders", async (request, reply) => {
    const input = portalCreateOrderSchema.parse(request.body);
    const client = await prisma.client.findUniqueOrThrow({
      where: { id: request.user.clientId },
    });

    let pickup: {
      pickupAddressRaw?: string;
      pickupLat?: number;
      pickupLng?: number;
      pickupNotes?: string;
    } = {};
    if (input.pickupMode === "REGISTERED") {
      if (!client.pickupAddressRaw) {
        return reply.code(400).send({
          error:
            "Su negocio no tiene dirección de recogida registrada. Pida a su operador configurarla, o indique una dirección puntual.",
          code: "NO_PICKUP_ADDRESS",
        });
      }
      pickup = {
        pickupAddressRaw: client.pickupAddressRaw,
        pickupLat: client.pickupLat ?? undefined,
        pickupLng: client.pickupLng ?? undefined,
        pickupNotes: client.pickupNotes ?? undefined,
      };
    } else if (input.pickupMode === "CUSTOM") {
      pickup = {
        pickupAddressRaw: input.pickupAddressRaw,
        pickupNotes: input.pickupNotes,
      };
    }

    const order = await createOrder(request.user.tenantId, {
      clientId: client.id,
      serviceId: input.serviceId,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      addressRaw: input.addressRaw,
      addressNotes: input.addressNotes,
      externalRef: input.externalRef,
      weightKg: input.weightKg,
      tempProfile: input.tempProfile,
      priority: 0,
      ...pickup,
    });
    return reply.code(201).send(withTrackingUrl(order));
  });

  /**
   * Servicios activos del operador disponibles para el negocio al crear un
   * envío (promesas de entrega con su plazo SLA). Tenant-scoped; solo lo
   * mínimo que el portal necesita mostrar.
   */
  app.get("/services", async (request) =>
    prisma.service.findMany({
      where: { tenantId: request.user.tenantId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, identifier: true, completionDeadlineMin: true },
    }),
  );

  /**
   * Validación de dirección al crear el envío: el moat como feature del
   * cliente. Avisa "esta dirección es ambigua" ANTES de que el paquete salga.
   */
  app.post("/address/validate", async (request) => {
    const body = z.object({ addressRaw: z.string().min(5) }).parse(request.body);
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: request.user.tenantId },
      select: { city: true },
    });
    const geo = await geocodeAddress(request.user.tenantId, body.addressRaw, tenant.city);
    // Cobertura por zona (D5): avisa al comercio si el destino cae fuera de las
    // zonas de cobertura ANTES de crear el envío (no bloquea — solo informa).
    const svc = await checkServiceability(request.user.tenantId, {
      lat: geo.lat,
      lng: geo.lng,
    });
    return {
      lat: geo.lat,
      lng: geo.lng,
      source: geo.source,
      confidence: geo.confidence,
      normalized: normalizeAddress(body.addressRaw),
      ambiguous: geo.confidence < LOW_CONFIDENCE_THRESHOLD,
      knownAddress: geo.source === "ADDRESS_PIN",
      hasZones: svc.hasZones,
      serviceable: !svc.hasZones || svc.covering.length > 0,
      coverageZones: svc.covering.map((z) => z.name),
    };
  });

  /**
   * Reprogramación de una entrega fallida por el COMERCIO (flujo B2B limpio):
   * crea un nuevo envío enlazado al fallido, con la misma carga y destino.
   */
  app.post("/orders/:id/reschedule", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        addressRaw: z.string().min(5).optional(),
        addressNotes: z.string().max(500).optional(),
      })
      .parse(request.body ?? {});

    const original = await prisma.order.findFirst({
      where: { id, tenantId: request.user.tenantId, clientId: request.user.clientId },
    });
    if (!original) return reply.code(404).send({ error: "Envío no encontrado" });
    if (!["FAILED", "REJECTED"].includes(original.status)) {
      return reply.code(409).send({ error: "Solo se reprograman envíos fallidos" });
    }
    if (original.recoveryStatus === "RESCHEDULED") {
      return reply.code(409).send({ error: "Este envío ya fue reprogramado" });
    }

    const reorder = await createOrder(request.user.tenantId, {
      clientId: original.clientId ?? undefined,
      customerName: original.customerName,
      customerPhone: original.customerPhone,
      addressRaw: body.addressRaw ?? original.addressRaw,
      addressNotes: body.addressNotes ?? original.addressNotes ?? undefined,
      externalRef: original.externalRef ?? undefined,
      weightKg: original.weightKg,
      tempProfile: original.tempProfile as CreateOrderInput["tempProfile"],
      priority: 5, // un reintento debe salir pronto
      // Sin dirección nueva: reusar el pin original (puede haber sido
      // corregido en campo por el conductor en el intento fallido).
      ...(body.addressRaw
        ? {}
        : original.lat !== null && original.lng !== null
          ? { lat: original.lat, lng: original.lng }
          : {}),
      pickupAddressRaw: original.pickupAddressRaw ?? undefined,
      pickupLat: original.pickupLat ?? undefined,
      pickupLng: original.pickupLng ?? undefined,
      pickupNotes: original.pickupNotes ?? undefined,
    });
    const linked = await prisma.order.update({
      where: { id: reorder.id },
      data: { rescheduledFromId: original.id },
    });
    const closed = await prisma.order.update({
      where: { id: original.id },
      data: { recoveryStatus: "RESCHEDULED" },
    });
    await logOrderEvent(
      original.id,
      "RECOVERY_RESCHEDULED",
      `Reprogramado por el comercio → nueva guía ${reorder.trackingNumber}`,
    );
    emitOrderUpdate(request.user.tenantId, closed);
    return reply.code(201).send(withTrackingUrl(linked));
  });

  /**
   * Resumen del tablero del portal: estados, actividad del mes, tasa de
   * éxito y tendencia de 30 días — para que el negocio entienda su operación
   * completa de un vistazo. Se calcula al vuelo: el volumen por cliente es
   * pequeño y el portal no depende de la infraestructura de rollups.
   */
  app.get("/summary", async (request) => {
    const tenantId = request.user.tenantId;
    const clientId = request.user.clientId!;
    const where = { tenantId, clientId };
    const month = currentMonth();
    const monthStart = new Date(`${month}-01T00:00:00.000Z`);
    const to = todayBogota();
    const from = addDays(to, -29);
    const { start, end } = bogotaUtcRange(from, to);

    const [byStatus, createdThisMonth, deliveredThisMonth, createdByDay, deliveredByDay] =
      await Promise.all([
        prisma.order.groupBy({ by: ["status"], where, _count: { _all: true } }),
        prisma.order.count({ where: { ...where, createdAt: { gte: monthStart } } }),
        prisma.order.count({
          where: { ...where, status: "DELIVERED", deliveredAt: { gte: monthStart } },
        }),
        prisma.$queryRaw<{ day: string; count: number }[]>`
          SELECT ((("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota')::date)::text AS day,
                 count(*)::int AS count
          FROM "Order"
          WHERE "tenantId" = ${tenantId} AND "clientId" = ${clientId}
            AND "createdAt" >= ${start} AND "createdAt" < ${end}
          GROUP BY 1
        `,
        prisma.$queryRaw<{ day: string; count: number }[]>`
          SELECT ((("deliveredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota')::date)::text AS day,
                 count(*)::int AS count
          FROM "Order"
          WHERE "tenantId" = ${tenantId} AND "clientId" = ${clientId}
            AND status = 'DELIVERED'
            AND "deliveredAt" >= ${start} AND "deliveredAt" < ${end}
          GROUP BY 1
        `,
      ]);

    const count = (status: string) =>
      byStatus.find((s) => s.status === status)?._count._all ?? 0;
    const delivered = count("DELIVERED");
    const attempted = delivered + count("FAILED") + count("REJECTED");
    const inTransit = count("ASSIGNED") + count("IN_TRANSIT");

    const createdMap = new Map(createdByDay.map((r) => [r.day, r.count]));
    const deliveredMap = new Map(deliveredByDay.map((r) => [r.day, r.count]));

    return {
      month,
      createdThisMonth,
      deliveredThisMonth,
      successRate: attempted === 0 ? null : delivered / attempted,
      inTransit,
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
      byDay: eachDay(from, to).map((day) => ({
        day,
        created: createdMap.get(day) ?? 0,
        delivered: deliveredMap.get(day) ?? 0,
      })),
    };
  });

  /** Informe verde mensual del negocio (CO₂ de sus envíos entregados). */
  app.get("/green-report", async (request) => {
    const query = z
      .object({ month: z.string().regex(MONTH_RE).optional() })
      .parse(request.query);
    return clientGreenReport(
      request.user.tenantId,
      request.user.clientId!,
      query.month ?? currentMonth(),
    );
  });
}
