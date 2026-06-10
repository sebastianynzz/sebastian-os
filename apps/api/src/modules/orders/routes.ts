import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createOrderSchema, ORDER_STATUSES } from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { geocodeAddress } from "../../services/geocoding.js";
import {
  generateTrackingNumber,
  logOrderEvents,
} from "../../services/orderEvents.js";

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

async function createOrder(
  tenantId: string,
  input: ReturnType<typeof createOrderSchema.parse>,
) {
  let lat = input.lat;
  let lng = input.lng;
  let geocodeSource = lat !== undefined && lng !== undefined ? "CLIENT" : undefined;

  let tenantCity: string | undefined;
  if (lat === undefined || lng === undefined) {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    tenantCity = tenant.city;
    const geo = await geocodeAddress(tenantId, input.addressRaw, tenant.city);
    lat = geo.lat;
    lng = geo.lng;
    geocodeSource = geo.source;
  }

  // Recogida en origen (opcional): geocodificar si se dio dirección sin coords.
  let pickupLat = input.pickupLat;
  let pickupLng = input.pickupLng;
  if (
    (pickupLat === undefined || pickupLng === undefined) &&
    input.pickupAddressRaw
  ) {
    if (!tenantCity) {
      tenantCity = (
        await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })
      ).city;
    }
    const geo = await geocodeAddress(tenantId, input.pickupAddressRaw, tenantCity);
    pickupLat = geo.lat;
    pickupLng = geo.lng;
  }

  // Validar que el negocio cliente (si se indica) pertenezca al tenant.
  if (input.clientId) {
    const client = await prisma.client.findFirst({
      where: { id: input.clientId, tenantId },
      select: { id: true },
    });
    if (!client) {
      throw Object.assign(new Error("Cliente no encontrado"), { statusCode: 400 });
    }
  }

  const order = await prisma.order.create({
    data: {
      tenantId,
      clientId: input.clientId,
      trackingNumber: generateTrackingNumber(),
      externalRef: input.externalRef,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      addressRaw: input.addressRaw,
      addressNotes: input.addressNotes,
      lat,
      lng,
      geocodeSource,
      pickupLat,
      pickupLng,
      pickupAddressRaw: input.pickupAddressRaw,
      pickupNotes: input.pickupNotes,
      status: "GEOCODED",
      weightKg: input.weightKg ?? 1,
      volumeM3: input.volumeM3,
      timeWindowStart: input.timeWindowStart ? new Date(input.timeWindowStart) : undefined,
      timeWindowEnd: input.timeWindowEnd ? new Date(input.timeWindowEnd) : undefined,
      priority: input.priority,
    },
  });

  await logOrderEvents([
    { orderId: order.id, type: "CREATED", details: `Guía ${order.trackingNumber}` },
    { orderId: order.id, type: "GEOCODED", details: `Fuente: ${geocodeSource}` },
  ]);
  return order;
}
