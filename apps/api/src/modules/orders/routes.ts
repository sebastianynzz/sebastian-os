import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createOrderSchema, ORDER_STATUSES } from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { createOrder } from "../../services/orders.js";
import { requireRole } from "../../plugins/auth.js";
import { notifyClient, publicTrackingUrl } from "../../services/notifications.js";
import { logOrderEvent } from "../../services/orderEvents.js";
import { emitOrderUpdate } from "../../services/realtime.js";

export default async function ordersRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request) => {
    const query = z
      .object({
        status: z.enum(ORDER_STATUSES).optional(),
        take: z.coerce.number().int().min(1).max(500).default(200),
      })
      .parse(request.query);

    return prisma.order.findMany({
      where: {
        tenantId: request.user.tenantId,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: query.take,
      include: {
        stops: { select: { routeId: true, kind: true, sequence: true, etaMin: true, status: true } },
        client: { select: { id: true, name: true, notifyChannel: true } },
      },
    });
  });

  app.get("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const order = await prisma.order.findFirst({
      where: { id, tenantId: request.user.tenantId },
      include: {
        stops: {
          orderBy: { sequence: "asc" },
          include: { pod: true, route: { select: { id: true, date: true, driverId: true } } },
        },
        events: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!order) return reply.code(404).send({ error: "Pedido no encontrado" });
    return order;
  });

  app.post("/", async (request, reply) => {
    const input = createOrderSchema.parse(request.body);
    const order = await createOrder(request.user.tenantId, input);
    return reply.code(201).send(order);
  });

  /** Carga masiva (import CSV procesado en el cliente, o integración API). */
  app.post("/bulk", async (request, reply) => {
    const inputs = z.array(createOrderSchema).min(1).max(500).parse(request.body);
    const orders = [];
    for (const input of inputs) {
      orders.push(await createOrder(request.user.tenantId, input));
    }
    return reply.code(201).send({ created: orders.length, orders });
  });

  /**
   * Recuperación B2B de una entrega fallida: el despachador marca el pedido y
   * se notifica al COMERCIO (nunca al consumidor final) para que reprograme
   * desde su portal. La inteligencia es nuestra; la relación es del comercio.
   */
  app.post(
    "/:id/recovery/flag",
    { preHandler: [requireRole("ADMIN", "DISPATCHER")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const order = await prisma.order.findFirst({
        where: { id, tenantId: request.user.tenantId },
        include: { client: true },
      });
      if (!order) return reply.code(404).send({ error: "Pedido no encontrado" });
      if (!["FAILED", "REJECTED"].includes(order.status)) {
        return reply
          .code(409)
          .send({ error: "Solo se recuperan pedidos fallidos o rechazados" });
      }
      if (order.recoveryStatus !== "NONE") {
        return reply.code(409).send({ error: "La recuperación ya fue iniciada" });
      }

      const updated = await prisma.order.update({
        where: { id: order.id },
        data: { recoveryStatus: "FLAGGED" },
      });
      await logOrderEvent(
        order.id,
        "RECOVERY_FLAGGED",
        "Marcado para reprogramación por el comercio",
      );
      await notifyClient({
        tenantId: order.tenantId,
        orderId: order.id,
        client: order.client,
        template: "entrega_fallida_reprogramar",
        payload: {
          trackingNumber: order.trackingNumber,
          customerName: order.customerName,
          failureReason: order.failureReason,
          trackingUrl: publicTrackingUrl(order.trackingToken),
          mensaje:
            "La entrega no pudo completarse. Puede reprogramarla desde su portal MoveOS.",
        },
      });
      emitOrderUpdate(order.tenantId, updated);
      return updated;
    },
  );
}
