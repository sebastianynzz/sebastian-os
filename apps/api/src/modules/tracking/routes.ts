import type { FastifyInstance } from "fastify";
import { trackingPingSchema } from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { isModuleEnabled } from "../../plugins/entitlements.js";
import { checkRouteDeviation } from "../../services/safety.js";

/**
 * Tracking núcleo: telemetría por smartphone del conductor (cero hardware).
 * La ingesta de dispositivos GPS dedicados (BYO device, Wialon/Teltonika/
 * Queclink) entra por esta misma vía en la fase 2 vía adaptadores.
 */
export default async function trackingRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.post("/pings", async (request, reply) => {
    if (!request.user.driverId) {
      return reply.code(403).send({ error: "Solo conductores reportan posición" });
    }
    const input = trackingPingSchema.parse(request.body);
    const tenantId = request.user.tenantId;

    const ping = await prisma.telemetryPing.create({
      data: {
        tenantId,
        driverId: request.user.driverId,
        routeId: input.routeId,
        lat: input.lat,
        lng: input.lng,
        speedKmh: input.speedKmh,
        heading: input.heading,
        batterySoc: input.batterySoc,
        recordedAt: input.recordedAt ? new Date(input.recordedAt) : new Date(),
      },
    });

    // Actualizar SoC del vehículo si la ruta es de un EV.
    if (input.routeId && input.batterySoc !== undefined) {
      const route = await prisma.route.findFirst({
        where: { id: input.routeId, tenantId },
        include: { vehicle: true },
      });
      if (route?.vehicle.isElectric) {
        await prisma.vehicle.update({
          where: { id: route.vehicleId },
          data: { socPercent: input.batterySoc },
        });
      }
    }

    // Detección de desviación de ruta (módulo SAFETY).
    if (input.routeId && (await isModuleEnabled(tenantId, "SAFETY"))) {
      await checkRouteDeviation(tenantId, request.user.driverId, input.routeId, input.lat, input.lng);
    }

    return reply.code(201).send(ping);
  });

  /** Últimas posiciones de todos los conductores (mapa del dispatcher). */
  app.get("/latest", async (request) => {
    const drivers = await prisma.driver.findMany({
      where: { tenantId: request.user.tenantId },
      select: { id: true, name: true },
    });
    const positions = [];
    for (const driver of drivers) {
      const last = await prisma.telemetryPing.findFirst({
        where: { tenantId: request.user.tenantId, driverId: driver.id },
        orderBy: { recordedAt: "desc" },
      });
      if (last) positions.push({ driver, ping: last });
    }
    return positions;
  });
}
