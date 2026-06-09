import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { failStopSchema, submitPodSchema, haversineKm } from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../../plugins/auth.js";
import { isModuleEnabled } from "../../plugins/entitlements.js";
import { learnAddressPin } from "../../services/geocoding.js";
import { notify } from "../../services/notifications.js";
import { logOrderEvent, logOrderEvents } from "../../services/orderEvents.js";

const GEOFENCE_RADIUS_KM = 0.3; // 300 m para validar POD georreferenciado

export default async function routesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request) => {
    const query = z.object({ date: z.string().optional() }).parse(request.query);
    return prisma.route.findMany({
      where: {
        tenantId: request.user.tenantId,
        ...(query.date ? { date: query.date } : {}),
      },
      include: {
        vehicle: true,
        driver: true,
        stops: {
          orderBy: { sequence: "asc" },
          include: { order: true, pod: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  app.get("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const route = await prisma.route.findFirst({
      where: { id, tenantId: request.user.tenantId },
      include: {
        vehicle: true,
        driver: true,
        stops: { orderBy: { sequence: "asc" }, include: { order: true, pod: true } },
      },
    });
    if (!route) return reply.code(404).send({ error: "Ruta no encontrada" });
    return route;
  });

  /** Despacho: asigna conductor y notifica a los clientes. */
  app.post(
    "/:id/dispatch",
    { preHandler: [requireRole("ADMIN", "DISPATCHER")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = z.object({ driverId: z.string() }).parse(request.body);

      const route = await prisma.route.findFirst({
        where: { id, tenantId: request.user.tenantId, status: "PLANNED" },
        include: { stops: { include: { order: true } } },
      });
      if (!route) return reply.code(404).send({ error: "Ruta no encontrada o ya despachada" });

      const driver = await prisma.driver.findFirst({
        where: { id: body.driverId, tenantId: request.user.tenantId },
      });
      if (!driver) return reply.code(404).send({ error: "Conductor no encontrado" });

      const updated = await prisma.route.update({
        where: { id },
        data: { driverId: driver.id, status: "DISPATCHED" },
      });

      await logOrderEvents(
        route.stops.map((s) => ({
          orderId: s.orderId,
          type: "DISPATCHED" as const,
          details: `Conductor: ${driver.name}`,
        })),
      );

      for (const stop of route.stops) {
        await notify({
          tenantId: request.user.tenantId,
          orderId: stop.orderId,
          recipient: stop.order.customerPhone,
          template: "pedido_asignado",
          payload: {
            cliente: stop.order.customerName,
            etaMin: stop.etaMin,
            conductor: driver.name,
          },
        });
      }
      return updated;
    },
  );

  /** El conductor inicia la ruta. */
  app.post("/:id/start", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const route = await prisma.route.findFirst({
      where: { id, tenantId: request.user.tenantId, status: "DISPATCHED" },
      include: { stops: { include: { order: true } } },
    });
    if (!route) return reply.code(404).send({ error: "Ruta no encontrada o no despachada" });
    if (request.user.role === "DRIVER" && route.driverId !== request.user.driverId) {
      return reply.code(403).send({ error: "Ruta de otro conductor" });
    }

    await prisma.route.update({ where: { id }, data: { status: "IN_PROGRESS" } });
    await prisma.order.updateMany({
      where: { id: { in: route.stops.map((s) => s.orderId) } },
      data: { status: "IN_TRANSIT" },
    });
    await logOrderEvents(
      route.stops.map((s) => ({
        orderId: s.orderId,
        type: "IN_TRANSIT" as const,
        details: "El conductor inició la ruta",
      })),
    );

    for (const stop of route.stops) {
      await notify({
        tenantId: request.user.tenantId,
        orderId: stop.orderId,
        recipient: stop.order.customerPhone,
        template: "pedido_en_camino",
        payload: { cliente: stop.order.customerName, etaMin: stop.etaMin },
      });
    }
    return { ok: true };
  });

  /** Ruta del día para el conductor autenticado (app conductor). */
  app.get("/driver/today", async (request, reply) => {
    if (!request.user.driverId) {
      return reply.code(403).send({ error: "El usuario no es conductor" });
    }
    const route = await prisma.route.findFirst({
      where: {
        tenantId: request.user.tenantId,
        driverId: request.user.driverId,
        status: { in: ["DISPATCHED", "IN_PROGRESS"] },
      },
      include: {
        vehicle: true,
        stops: { orderBy: { sequence: "asc" }, include: { order: true, pod: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return route ?? null;
  });

  app.post("/stops/:stopId/arrive", async (request, reply) => {
    const { stopId } = z.object({ stopId: z.string() }).parse(request.params);
    const stop = await findStopForUser(request, stopId);
    if (!stop) return reply.code(404).send({ error: "Parada no encontrada" });

    const updated = await prisma.routeStop.update({
      where: { id: stopId },
      data: { status: "ARRIVED", arrivedAt: new Date() },
    });
    await logOrderEvent(stop.orderId, "ARRIVED", "Conductor en el punto de entrega");
    return updated;
  });

  /**
   * Completar parada: registra POD, valida geocerca, recauda COD (si el módulo
   * está activo) y aprende el pin GPS de la dirección (grafo de direcciones).
   */
  app.post("/stops/:stopId/complete", async (request, reply) => {
    const { stopId } = z.object({ stopId: z.string() }).parse(request.params);
    const input = submitPodSchema.parse(request.body);
    const stop = await findStopForUser(request, stopId);
    if (!stop) return reply.code(404).send({ error: "Parada no encontrada" });
    if (stop.status === "COMPLETED") {
      return reply.code(409).send({ error: "Parada ya completada" });
    }

    const tenantId = request.user.tenantId;
    const order = stop.order;

    // COD: el recaudo requiere el módulo activo.
    if (order.paymentType === "COD") {
      if (!input.cod) {
        return reply.code(400).send({ error: "Pedido COD requiere registrar el recaudo" });
      }
      const codEnabled = await isModuleEnabled(tenantId, "COD");
      if (!codEnabled) {
        return reply.code(403).send({
          error: "Módulo no activo: COD",
          code: "MODULE_NOT_ENABLED",
          moduleKey: "COD",
        });
      }
    }

    let geofenceOk: boolean | null = null;
    if (input.lat !== undefined && input.lng !== undefined && order.lat !== null && order.lng !== null) {
      geofenceOk =
        haversineKm(
          { lat: input.lat, lng: input.lng },
          { lat: order.lat, lng: order.lng },
        ) <= GEOFENCE_RADIUS_KM;
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.routeStop.update({
        where: { id: stopId },
        data: {
          status: "COMPLETED",
          completedAt: now,
          pod: {
            create: {
              types: input.types,
              photoUrl: input.photoUrl,
              signatureUrl: input.signatureUrl,
              receivedBy: input.receivedBy,
              notes: input.notes,
              lat: input.lat,
              lng: input.lng,
              geofenceOk,
            },
          },
        },
      });
      await tx.order.update({
        where: { id: order.id },
        data: { status: "DELIVERED", deliveredAt: now },
      });
      if (order.paymentType === "COD" && input.cod) {
        await tx.codPayment.create({
          data: {
            tenantId,
            orderId: order.id,
            driverId: stop.route.driverId,
            amount: input.cod.amount,
            method: input.cod.method,
            status: "COLLECTED",
          },
        });
      }
    });

    await logOrderEvent(
      order.id,
      "DELIVERED",
      input.receivedBy ? `Recibió: ${input.receivedBy}` : undefined,
    );
    if (order.paymentType === "COD" && input.cod) {
      await logOrderEvent(
        order.id,
        "COD_COLLECTED",
        `$${input.cod.amount.toLocaleString("es-CO")} vía ${input.cod.method}`,
      );
    }

    // Aprender el pin GPS confirmado (mejora geocodificación futura).
    if (input.lat !== undefined && input.lng !== undefined) {
      await learnAddressPin(
        tenantId,
        order.addressRaw,
        input.lat,
        input.lng,
        order.addressNotes ?? undefined,
      );
    }

    await notify({
      tenantId,
      orderId: order.id,
      recipient: order.customerPhone,
      template: "pedido_entregado",
      payload: { cliente: order.customerName, recibidoPor: input.receivedBy ?? null },
    });

    await maybeCompleteRoute(stop.route.id);
    return { ok: true, geofenceOk };
  });

  app.post("/stops/:stopId/fail", async (request, reply) => {
    const { stopId } = z.object({ stopId: z.string() }).parse(request.params);
    const input = failStopSchema.parse(request.body);
    const stop = await findStopForUser(request, stopId);
    if (!stop) return reply.code(404).send({ error: "Parada no encontrada" });

    const isRejection = input.reason.startsWith("RECHAZO");
    await prisma.$transaction([
      prisma.routeStop.update({
        where: { id: stopId },
        data: { status: "FAILED", completedAt: new Date() },
      }),
      prisma.order.update({
        where: { id: stop.orderId },
        data: {
          status: isRejection ? "REJECTED" : "FAILED",
          failureReason: input.reason,
        },
      }),
    ]);
    await logOrderEvent(stop.orderId, "FAILED", `Motivo: ${input.reason}`);

    await notify({
      tenantId: request.user.tenantId,
      orderId: stop.orderId,
      recipient: stop.order.customerPhone,
      template: "pedido_fallido",
      payload: { cliente: stop.order.customerName, motivo: input.reason },
    });

    await maybeCompleteRoute(stop.route.id);
    return { ok: true };
  });
}

async function findStopForUser(
  request: { user: { tenantId: string; role: string; driverId?: string } },
  stopId: string,
) {
  const stop = await prisma.routeStop.findFirst({
    where: { id: stopId, route: { tenantId: request.user.tenantId } },
    include: { order: true, route: true },
  });
  if (!stop) return null;
  if (
    request.user.role === "DRIVER" &&
    stop.route.driverId !== request.user.driverId
  ) {
    return null;
  }
  return stop;
}

/** Si todas las paradas terminaron, cierra la ruta. */
async function maybeCompleteRoute(routeId: string) {
  const open = await prisma.routeStop.count({
    where: { routeId, status: { in: ["PENDING", "ARRIVED"] } },
  });
  if (open === 0) {
    await prisma.route.update({
      where: { id: routeId },
      data: { status: "COMPLETED" },
    });
  }
}
