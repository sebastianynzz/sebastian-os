import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { estimateUsableRangeKm, reeferEnergyKwh } from "@moveos/optimizer";
import { haversineKm, VEHICLE_TYPE_PROFILES, type VehicleConfig } from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";

/**
 * Gestión de flota eléctrica: SoC, autonomía dinámica y red de carga.
 * Colombia es líder EV en LatAm pero con infraestructura de carga escasa
 * (~774 puntos oficiales a dic 2025): la planificación de autonomía importa
 * más que en mercados maduros.
 *
 * NÚCLEO, no módulo de pago: MoveOS es EV-only (restricción dura 1.3) —
 * autonomía y carga están disponibles para todo tenant, sin requireModule.
 * El conductor (rol DRIVER) también consulta estos endpoints: SoC en vivo y
 * cargador más cercano son parte de su jornada.
 */
export default async function evRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  /** Estado de la flota eléctrica con autonomía útil estimada. */
  app.get("/overview", async (request) => {
    const vehicles = await prisma.vehicle.findMany({
      where: { tenantId: request.user.tenantId, isElectric: true },
    });
    return vehicles.map((v) => {
      // Refrigeración: SOLO analítica de energía (las autonomías ya son
      // reefer-on, restricción dura 1.6/7 — nunca se penaliza el rango).
      const profile = VEHICLE_TYPE_PROFILES[v.type as VehicleConfig];
      const reefer = profile?.reefer
        ? {
            drawKw: Number(reeferEnergyKwh(v.type as VehicleConfig, 1).toFixed(2)),
            shiftKwh: Number(reeferEnergyKwh(v.type as VehicleConfig, 8).toFixed(1)),
            modes: profile.reefer.modes,
            unit: profile.reefer.unit,
          }
        : null;
      return {
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
        reefer,
      };
    });
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
   * Directorio de carga: red pública compartida (tenantId null) + cargadores
   * de depósito del tenant. Con ?lat&lng ordena por cercanía (haversine) —
   * es la consulta del "cargador más cercano" del conductor. La
   * disponibilidad en vivo (OCPP) es fase 3.
   */
  app.get("/charging-stations", async (request) => {
    const query = z
      .object({
        lat: z.coerce.number().min(-90).max(90).optional(),
        lng: z.coerce.number().min(-180).max(180).optional(),
        city: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(50).optional(),
      })
      .parse(request.query);

    const origin =
      query.lat !== undefined && query.lng !== undefined
        ? { lat: query.lat, lng: query.lng }
        : null;

    // Con origen hay que traer todo para ordenar por cercanía (sin PostGIS);
    // sin origen el límite sí se empuja a la base.
    const stations = await prisma.chargingStation.findMany({
      where: {
        status: "ACTIVE",
        OR: [{ tenantId: null }, { tenantId: request.user.tenantId }],
        ...(query.city ? { city: query.city } : {}),
      },
      orderBy: { name: "asc" },
      ...(origin === null && query.limit ? { take: query.limit } : {}),
    });
    const result = stations.map((s) => ({
      id: s.id,
      name: s.name,
      network: s.network,
      address: s.address,
      city: s.city,
      lat: s.lat,
      lng: s.lng,
      connectors: s.connectors,
      powerKw: s.powerKw,
      dcFast: s.dcFast,
      isDepot: s.tenantId !== null,
      distanceKm: origin
        ? Number(haversineKm(origin, { lat: s.lat, lng: s.lng }).toFixed(2))
        : null,
    }));
    if (origin) {
      result.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
    }
    return query.limit ? result.slice(0, query.limit) : result;
  });
}
