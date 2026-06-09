import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { estimateUsableRangeKm } from "@moveos/optimizer";
import { prisma } from "../../lib/prisma.js";
import { requireModule } from "../../plugins/entitlements.js";

/**
 * Módulo de gestión de flota eléctrica: SoC, autonomía dinámica y red de carga.
 * Colombia es líder EV en LatAm pero con infraestructura de carga escasa
 * (~774 puntos oficiales a dic 2025): la planificación de autonomía importa
 * más que en mercados maduros.
 */
export default async function evRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.addHook("preHandler", requireModule("EV_MANAGEMENT"));

  /** Estado de la flota eléctrica con autonomía útil estimada. */
  app.get("/overview", async (request) => {
    const vehicles = await prisma.vehicle.findMany({
      where: { tenantId: request.user.tenantId, isElectric: true },
    });
    return vehicles.map((v) => ({
      id: v.id,
      plate: v.plate,
      type: v.type,
      batteryKwh: v.batteryKwh,
      nominalRangeKm: v.nominalRangeKm,
      socPercent: v.socPercent,
      usableRangeKm:
        v.nominalRangeKm !== null
          ? Number(
              estimateUsableRangeKm({
                nominalRangeKm: v.nominalRangeKm,
                socPercent: v.socPercent ?? 100,
              }).toFixed(1),
            )
          : null,
      lowBattery: (v.socPercent ?? 100) < 25,
    }));
  });

  /** Actualización manual o vía telemática del estado de carga. */
  app.patch("/vehicles/:id/soc", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({ socPercent: z.number().min(0).max(100) })
      .parse(request.body);
    const vehicle = await prisma.vehicle.findFirst({
      where: { id, tenantId: request.user.tenantId, isElectric: true },
    });
    if (!vehicle) return reply.code(404).send({ error: "Vehículo eléctrico no encontrado" });
    return prisma.vehicle.update({
      where: { id },
      data: { socPercent: body.socPercent },
    });
  });

  /** Estimador de autonomía con condiciones de operación. */
  app.get("/range-estimate", async (request, reply) => {
    const query = z
      .object({
        vehicleId: z.string(),
        temperatureC: z.coerce.number().optional(),
        payloadKg: z.coerce.number().optional(),
        elevationGainM: z.coerce.number().optional(),
      })
      .parse(request.query);
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: query.vehicleId, tenantId: request.user.tenantId, isElectric: true },
    });
    if (!vehicle?.nominalRangeKm) {
      return reply.code(404).send({ error: "Vehículo EV sin autonomía nominal configurada" });
    }
    return {
      vehicleId: vehicle.id,
      plate: vehicle.plate,
      socPercent: vehicle.socPercent ?? 100,
      usableRangeKm: Number(
        estimateUsableRangeKm({
          nominalRangeKm: vehicle.nominalRangeKm,
          socPercent: vehicle.socPercent ?? 100,
          temperatureC: query.temperatureC,
          payloadKg: query.payloadKg,
          elevationGainM: query.elevationGainM,
        }).toFixed(1),
      ),
    };
  });

  /**
   * Red de carga (datos estáticos de arranque; en producción se integran las
   * APIs de Terpel Voltex, Enel X, EPM y Celsia, más OCPP para cargadores
   * propios del depósito).
   */
  app.get("/charging-stations", async () => {
    return CHARGING_STATIONS_BOGOTA;
  });
}

const CHARGING_STATIONS_BOGOTA = [
  { name: "Terpel Voltex — Calle 100", network: "Terpel Voltex", lat: 4.6864, lng: -74.0521, connectors: ["CCS", "Type 2"], dc: true },
  { name: "Terpel Voltex — Av. Boyacá", network: "Terpel Voltex", lat: 4.6612, lng: -74.1149, connectors: ["CCS", "CHAdeMO"], dc: true },
  { name: "Enel X — Parque de la 93", network: "Enel X", lat: 4.6766, lng: -74.0488, connectors: ["Type 2"], dc: false },
  { name: "Enel X — Centro Mayor", network: "Enel X", lat: 4.5781, lng: -74.1206, connectors: ["Type 2", "CCS"], dc: true },
  { name: "Celsia — Zona Industrial Montevideo", network: "Celsia", lat: 4.6253, lng: -74.1247, connectors: ["CCS"], dc: true },
];
