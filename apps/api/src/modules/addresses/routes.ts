import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../../plugins/auth.js";
import {
  geocodeAddress,
  learnAddressPin,
  normalizeAddress,
  LOW_CONFIDENCE_THRESHOLD,
} from "../../services/geocoding.js";
import { logOrderEvent } from "../../services/orderEvents.js";
import { emitOrderUpdate } from "../../services/realtime.js";

/**
 * Inteligencia de direcciones (núcleo, no es módulo de pago): la cola de
 * triage del despachador y los flujos de corrección de pin que alimentan el
 * grafo de direcciones. "Corregir 12 direcciones, no 12 entregas fallidas."
 */
export default async function addressesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  /**
   * Cola de triage: pedidos aún no despachados cuya dirección tiene baja
   * confianza y nadie ha confirmado. Se revisan ANTES de planificar.
   */
  app.get("/triage", async (request) => {
    const orders = await prisma.order.findMany({
      where: {
        tenantId: request.user.tenantId,
        status: { in: ["PENDING", "GEOCODED", "ASSIGNED"] },
        addressVerifiedAt: null,
        OR: [
          { geoConfidence: { lt: LOW_CONFIDENCE_THRESHOLD } },
          { geoConfidence: null },
          { geocodeSource: "MOCK" },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: {
        id: true,
        trackingNumber: true,
        customerName: true,
        addressRaw: true,
        addressNotes: true,
        lat: true,
        lng: true,
        geocodeSource: true,
        geoConfidence: true,
        status: true,
        createdAt: true,
        client: { select: { id: true, name: true } },
      },
    });
    return { threshold: LOW_CONFIDENCE_THRESHOLD, orders };
  });

  /**
   * Validación previa de una dirección (sin crear pedido): geocodifica y
   * devuelve fuente + confianza para que la UI avise "dirección ambigua".
   */
  app.post("/validate", async (request) => {
    const body = z
      .object({ addressRaw: z.string().min(5), city: z.string().optional() })
      .parse(request.body);
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: request.user.tenantId },
    });
    const geo = await geocodeAddress(
      request.user.tenantId,
      body.addressRaw,
      body.city ?? tenant.city,
    );
    return {
      ...geo,
      normalized: normalizeAddress(body.addressRaw),
      ambiguous: geo.confidence < LOW_CONFIDENCE_THRESHOLD,
    };
  });

  /**
   * Corrección del despachador (triage): fija el pin manualmente, marca la
   * dirección como verificada y enseña el pin al grafo.
   */
  app.patch(
    "/orders/:id/location",
    { preHandler: [requireRole("ADMIN", "DISPATCHER")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = z
        .object({
          lat: z.number().min(-90).max(90),
          lng: z.number().min(-180).max(180),
          referenceNotes: z.string().max(280).optional(),
        })
        .parse(request.body);

      const order = await prisma.order.findFirst({
        where: { id, tenantId: request.user.tenantId },
        include: { tenant: { select: { city: true } } },
      });
      if (!order) return reply.code(404).send({ error: "Pedido no encontrado" });
      if (["DELIVERED", "CANCELLED"].includes(order.status)) {
        return reply.code(409).send({ error: "El pedido ya fue cerrado" });
      }

      const updated = await prisma.order.update({
        where: { id: order.id },
        data: {
          lat: body.lat,
          lng: body.lng,
          geocodeSource: "MANUAL_PIN",
          geoConfidence: 1,
          addressVerifiedAt: new Date(),
        },
      });
      await learnAddressPin(
        order.tenantId,
        order.addressRaw,
        body.lat,
        body.lng,
        body.referenceNotes ?? order.addressNotes ?? undefined,
        { source: "DISPATCHER_CONFIRMED", city: order.tenant.city },
      );
      await logOrderEvent(
        order.id,
        "ADDRESS_CONFIRMED",
        "Pin corregido por despacho (triage de direcciones)",
      );
      emitOrderUpdate(order.tenantId, updated);
      return updated;
    },
  );

  /**
   * Corrección del conductor en campo: el tap más valioso del producto.
   * Cuando el conductor llega y el pin guardado está lejos de la entrega
   * real, confirma la ubicación verdadera con su GPS.
   */
  app.post("/orders/:id/driver-fix", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        referenceNotes: z.string().max(280).optional(),
      })
      .parse(request.body);

    const order = await prisma.order.findFirst({
      where: { id, tenantId: request.user.tenantId },
      include: { tenant: { select: { city: true } } },
    });
    if (!order) return reply.code(404).send({ error: "Pedido no encontrado" });

    // Un conductor solo corrige pedidos de sus propias rutas.
    if (request.user.role === "DRIVER") {
      const ownStop = await prisma.routeStop.findFirst({
        where: {
          orderId: order.id,
          route: { driverId: request.user.driverId ?? "" },
        },
        select: { id: true },
      });
      if (!ownStop) {
        return reply.code(403).send({ error: "El pedido no está en tu ruta" });
      }
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        lat: body.lat,
        lng: body.lng,
        geocodeSource: "DRIVER_PIN",
        geoConfidence: 1,
        addressVerifiedAt: new Date(),
      },
    });
    await learnAddressPin(
      order.tenantId,
      order.addressRaw,
      body.lat,
      body.lng,
      body.referenceNotes ?? order.addressNotes ?? undefined,
      { source: "DRIVER_CONFIRMED", city: order.tenant.city },
    );
    await logOrderEvent(
      order.id,
      "ADDRESS_CONFIRMED",
      "Pin corregido por el conductor en campo",
    );
    emitOrderUpdate(order.tenantId, updated);
    return updated;
  });
}
