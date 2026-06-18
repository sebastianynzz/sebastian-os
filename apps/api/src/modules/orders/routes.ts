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
        service: { select: { id: true, name: true, identifier: true, completionDeadlineMin: true } },
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

  /**
   * Carga masiva (import CSV procesado en el cliente, o integración API).
   * Resiliente por fila: una fila inválida NO tumba el lote — se validan y
   * crean fila por fila y se devuelve el detalle por fila para que el
   * despachador vea exactamente cuáles fallaron y por qué (las buenas entran).
   */
  app.post("/bulk", async (request, reply) => {
    const rows = z.array(z.unknown()).min(1).max(500).parse(request.body);
    const results: {
      row: number;
      ok: boolean;
      error?: string;
      id?: string;
      trackingNumber?: string;
    }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const parsed = createOrderSchema.safeParse(rows[i]);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = issue?.path.join(".");
        results.push({
          row: i + 1,
          ok: false,
          error: field ? `${field}: ${issue?.message}` : issue?.message ?? "Fila inválida",
        });
        continue;
      }
      try {
        const order = await createOrder(request.user.tenantId, parsed.data);
        results.push({
          row: i + 1,
          ok: true,
          id: order.id,
          trackingNumber: order.trackingNumber ?? undefined,
        });
      } catch (err) {
        results.push({
          row: i + 1,
          ok: false,
          error: err instanceof Error ? err.message : "Error al crear el pedido",
        });
      }
    }

    const created = results.filter((r) => r.ok).length;
    return reply.code(201).send({
      created,
      failed: results.length - created,
      results,
    });
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
