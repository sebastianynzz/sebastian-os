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
          tenant: { select: { name: true } },
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
            select: { kind: true, etaMin: true, status: true, routeId: true },
          },
        },
      });

      if (!order) {
        return reply.code(404).send({ error: "Envío no encontrado" });
      }

      // Posición del conductor solo si hay una entrega aún en curso.
      const deliveryStop = order.stops.find((s) => s.kind === "DELIVERY");
      let driverPosition: { lat: number; lng: number; at: string } | null = null;
      if (
        order.status === "IN_TRANSIT" &&
        deliveryStop?.routeId &&
        deliveryStop.status !== "COMPLETED"
      ) {
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
