import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createOrderSchema, ORDER_STATUSES } from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { createOrder } from "../../services/orders.js";

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
}
