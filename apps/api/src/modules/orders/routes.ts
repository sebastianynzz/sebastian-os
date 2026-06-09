import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createOrderSchema, ORDER_STATUSES } from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { geocodeAddress } from "../../services/geocoding.js";

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
      include: { stop: { select: { routeId: true, sequence: true, etaMin: true, status: true } } },
    });
  });

  app.get("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const order = await prisma.order.findFirst({
      where: { id, tenantId: request.user.tenantId },
      include: {
        stop: { include: { pod: true, route: { select: { id: true, date: true, driverId: true } } } },
        codPayment: true,
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

async function createOrder(
  tenantId: string,
  input: ReturnType<typeof createOrderSchema.parse>,
) {
  let lat = input.lat;
  let lng = input.lng;
  let geocodeSource = lat !== undefined && lng !== undefined ? "CLIENT" : undefined;

  if (lat === undefined || lng === undefined) {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const geo = await geocodeAddress(tenantId, input.addressRaw, tenant.city);
    lat = geo.lat;
    lng = geo.lng;
    geocodeSource = geo.source;
  }

  if (input.paymentType === "COD" && !input.codAmount) {
    throw Object.assign(new Error("Pedido COD requiere codAmount"), {
      statusCode: 400,
    });
  }

  return prisma.order.create({
    data: {
      tenantId,
      externalRef: input.externalRef,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      addressRaw: input.addressRaw,
      addressNotes: input.addressNotes,
      lat,
      lng,
      geocodeSource,
      status: "GEOCODED",
      paymentType: input.paymentType,
      codAmount: input.codAmount,
      weightKg: input.weightKg ?? 1,
      volumeM3: input.volumeM3,
      timeWindowStart: input.timeWindowStart ? new Date(input.timeWindowStart) : undefined,
      timeWindowEnd: input.timeWindowEnd ? new Date(input.timeWindowEnd) : undefined,
      priority: input.priority,
    },
  });
}
