import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ORDER_STATUSES, portalCreateOrderSchema } from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { createOrder } from "../../services/orders.js";
import {
  clientGreenReport,
  currentMonth,
  MONTH_RE,
} from "../../services/greenReport.js";
import { publicTrackingUrl } from "../../services/notifications.js";

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
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      addressRaw: input.addressRaw,
      addressNotes: input.addressNotes,
      externalRef: input.externalRef,
      weightKg: input.weightKg,
      priority: 0,
      ...pickup,
    });
    return reply.code(201).send(withTrackingUrl(order));
  });

  /** Resumen del tablero del portal: estados y actividad del mes. */
  app.get("/summary", async (request) => {
    const where = {
      tenantId: request.user.tenantId,
      clientId: request.user.clientId,
    };
    const month = currentMonth();
    const monthStart = new Date(`${month}-01T00:00:00.000Z`);

    const [byStatus, createdThisMonth, deliveredThisMonth] = await Promise.all([
      prisma.order.groupBy({ by: ["status"], where, _count: { _all: true } }),
      prisma.order.count({ where: { ...where, createdAt: { gte: monthStart } } }),
      prisma.order.count({
        where: { ...where, status: "DELIVERED", deliveredAt: { gte: monthStart } },
      }),
    ]);

    return {
      month,
      createdThisMonth,
      deliveredThisMonth,
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
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
