import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { openSseStream, subscribeOrder } from "../../services/realtime.js";

/**
 * Página pública de rastreo (SIN autenticación). El negocio cliente sigue su
 * envío con un token opaco, sin login. Devuelve solo información sanitizada:
 * estado, línea de tiempo (bitácora) y, si está en ruta, la posición más
 * reciente del conductor. Nunca expone teléfonos internos ni datos de otros
 * pedidos o tenants.
 */

const PUBLIC_EVENT_LABELS: Record<string, string> = {
  CREATED: "Pedido registrado",
  GEOCODED: "Dirección confirmada",
  ASSIGNED: "Asignado a una ruta",
  DISPATCHED: "Salió a reparto",
  IN_TRANSIT: "En camino",
  ARRIVED: "Conductor en el punto",
  PICKED_UP: "Paquete recogido",
  DELIVERED: "Entregado",
  FAILED: "Entrega no lograda",
};

export default async function publicTrackingRoutes(app: FastifyInstance) {
  /**
   * Stream SSE del rastreo público: empuja un "update" cuando el envío cambia
   * de estado o el conductor reporta posición en una entrega en curso. La
   * página /t/:token recarga al recibirlo en vez de sondear cada 20 s.
   */
  app.get(
    "/:token/stream",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { token } = z.object({ token: z.string().min(10) }).parse(request.params);
      const order = await prisma.order.findUnique({
        where: { trackingToken: token },
        select: { id: true },
      });
      if (!order) return reply.code(404).send({ error: "Envío no encontrado" });

      const { sub, onClose } = openSseStream(request, reply);
      onClose(subscribeOrder(order.id, sub));
    },
  );

  app.get(
    "/:token",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { token } = z.object({ token: z.string().min(10) }).parse(request.params);

      const order = await prisma.order.findUnique({
        where: { trackingToken: token },
        select: {
          trackingNumber: true,
          customerName: true,
          addressRaw: true,
          status: true,
          deliveredAt: true,
          tenant: { select: { name: true, trackingTier: true } },
          client: { select: { name: true } },
          events: {
            where: {
              type: { in: Object.keys(PUBLIC_EVENT_LABELS) },
            },
            orderBy: { createdAt: "asc" },
            select: { type: true, createdAt: true },
          },
          stops: {
            orderBy: { sequence: "asc" },
            select: { kind: true, etaMin: true, status: true, routeId: true, sequence: true },
          },
        },
      });

      if (!order) {
        return reply.code(404).send({ error: "Envío no encontrado" });
      }

      // Nivel de privacidad del rastreo público (Tier 2). Por defecto FULL.
      const tier = order.tenant.trackingTier;
      const inTransit =
        order.status === "IN_TRANSIT" &&
        order.stops.some((s) => s.kind === "DELIVERY" && s.status !== "COMPLETED");
      const deliveryStop = order.stops.find((s) => s.kind === "DELIVERY");

      // Posición en la cola de la ruta (ETA_POSITION y FULL): cuántas paradas
      // pendientes van antes de la tuya — sin exponer ubicación ni otros pedidos.
      let queuePosition: { position: number; totalPending: number } | null = null;
      if (
        (tier === "ETA_POSITION" || tier === "FULL") &&
        inTransit &&
        deliveryStop?.routeId
      ) {
        const routeStops = await prisma.routeStop.findMany({
          where: {
            routeId: deliveryStop.routeId,
            status: { in: ["PENDING", "ARRIVED"] },
          },
          select: { sequence: true },
        });
        const ahead = routeStops.filter(
          (s) => s.sequence < deliveryStop.sequence,
        ).length;
        queuePosition = { position: ahead + 1, totalPending: routeStops.length };
      }

      // Ubicación del conductor en vivo SOLO en FULL.
      let driverPosition: { lat: number; lng: number; at: string } | null = null;
      if (tier === "FULL" && inTransit && deliveryStop?.routeId) {
        const route = await prisma.route.findUnique({
          where: { id: deliveryStop.routeId },
          select: { driverId: true, tenantId: true },
        });
        if (route?.driverId) {
          const ping = await prisma.telemetryPing.findFirst({
            where: { driverId: route.driverId, tenantId: route.tenantId },
            orderBy: { recordedAt: "desc" },
            select: { lat: true, lng: true, recordedAt: true },
          });
          if (ping) {
            driverPosition = {
              lat: ping.lat,
              lng: ping.lng,
              at: ping.recordedAt.toISOString(),
            };
          }
        }
      }

      return {
        trackingNumber: order.trackingNumber,
        recipient: order.customerName,
        address: order.addressRaw,
        operator: order.tenant.name,
        sender: order.client?.name ?? null,
        status: order.status,
        deliveredAt: order.deliveredAt,
        etaMin: deliveryStop?.etaMin ?? null,
        trackingTier: tier,
        queuePosition,
        timeline: order.events.map((e) => ({
          type: e.type,
          label: PUBLIC_EVENT_LABELS[e.type] ?? e.type,
          at: e.createdAt.toISOString(),
        })),
        driverPosition,
      };
    },
  );
}
