import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  telemetryIngestSchema,
  vehicleCommandSchema,
} from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { requireModule, isModuleEnabled } from "../../plugins/entitlements.js";
import { requireRole } from "../../plugins/auth.js";
import { checkRouteDeviation } from "../../services/safety.js";
import { emitPlatform, emitTenant } from "../../services/realtime.js";

/**
 * Plano telemático / IoT: ingesta de GPS + datos CAN bus (moto / camión
 * liviano) e inmovilización de motor (encendido/apagado vía relé del
 * dispositivo telemático).
 *
 * La ingesta es agnóstica del transporte: el simulador, el smartphone del
 * conductor o un agregador de hardware (Flespi / Wialon retransmitiendo
 * dispositivos Teltonika/Queclink) entran todos por `POST /telematics/ingest`.
 *
 * IMPORTANTE (seguridad y legalidad): el apagado de motor es un relé sobre el
 * circuito de arranque/combustible, NO una escritura al CAN bus, y SOLO se
 * permite con el vehículo detenido (velocidad = 0). Cortar un vehículo en
 * movimiento es peligroso e ilegal.
 */
export default async function telematicsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.addHook("preHandler", requireModule("TELEMATICS"));

  /** Ingesta de un ping (dispositivo / smartphone / simulador). */
  app.post("/ingest", async (request, reply) => {
    const input = telemetryIngestSchema.parse(request.body);
    const tenantId = request.user.tenantId;

    const plate = input.plate.toUpperCase().replace(/\s/g, "");
    const vehicle = await prisma.vehicle.findFirst({
      where: { tenantId, plate },
    });
    if (!vehicle) {
      return reply.code(404).send({ error: `Vehículo no encontrado: ${plate}` });
    }

    const ping = await prisma.telemetryPing.create({
      data: {
        tenantId,
        vehicleId: vehicle.id,
        driverId: request.user.driverId ?? null,
        routeId: input.routeId,
        lat: input.lat,
        lng: input.lng,
        speedKmh: input.speedKmh,
        heading: input.heading,
        batterySoc: input.batterySoc,
        rpm: input.rpm,
        odometerKm: input.odometerKm,
        fuelLevelPct: input.fuelLevelPct,
        coolantTempC: input.coolantTempC,
        engineOn: input.engineOn,
        source: input.source,
        recordedAt: input.recordedAt ? new Date(input.recordedAt) : new Date(),
      },
    });

    // Actualizar el último estado conocido del vehículo (fuente del interlock).
    await prisma.vehicle.update({
      where: { id: vehicle.id },
      data: {
        lastSpeedKmh: input.speedKmh ?? vehicle.lastSpeedKmh,
        lastSeenAt: ping.recordedAt,
        lastLat: input.lat,
        lastLng: input.lng,
        ...(input.batterySoc !== undefined ? { socPercent: input.batterySoc } : {}),
        ...(input.engineOn !== undefined ? { engineOn: input.engineOn } : {}),
      },
    });

    // Detección de desviación de ruta (requiere el módulo SAFETY del tenant).
    if (input.routeId && (await isModuleEnabled(tenantId, "SAFETY"))) {
      await checkRouteDeviation(
        tenantId,
        request.user.driverId ?? null,
        input.routeId,
        input.lat,
        input.lng,
      );
    }

    // Tiempo real: mapa en vivo del tenant y, si el activo es FaaS (dueño
    // distinto del operador), el panel de flota de la plataforma.
    emitTenant(tenantId, "telemetry", {
      vehicleId: vehicle.id,
      plate: vehicle.plate,
      lat: input.lat,
      lng: input.lng,
      speedKmh: input.speedKmh ?? null,
      engineOn: input.engineOn ?? null,
      recordedAt: ping.recordedAt.toISOString(),
    });
    if (vehicle.ownerTenantId) {
      emitPlatform("fleet", { vehicleId: vehicle.id, plate: vehicle.plate });
    }

    return reply.code(201).send({ id: ping.id });
  });

  /** Último estado por vehículo para el mapa en vivo del dispatcher. */
  app.get("/vehicles/live", async (request) => {
    const tenantId = request.user.tenantId;
    const vehicles = await prisma.vehicle.findMany({
      where: { tenantId },
      orderBy: { plate: "asc" },
    });

    const result = [];
    for (const v of vehicles) {
      const last = await prisma.telemetryPing.findFirst({
        where: { tenantId, vehicleId: v.id },
        orderBy: { recordedAt: "desc" },
      });
      result.push({
        vehicle: {
          id: v.id,
          plate: v.plate,
          type: v.type,
          isElectric: v.isElectric,
          engineOn: v.engineOn,
          immobilized: v.immobilized,
          lastSpeedKmh: v.lastSpeedKmh,
          socPercent: v.socPercent,
          lastSeenAt: v.lastSeenAt,
        },
        ping: last,
      });
    }
    return result;
  });

  // --- Comandos de inmovilización (gated por SAFETY, rol ADMIN/DISPATCHER) ---

  /** Historial de comandos de un vehículo. */
  app.get(
    "/vehicles/:id/commands",
    { preHandler: [requireModule("SAFETY")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const vehicle = await prisma.vehicle.findFirst({
        where: { id, tenantId: request.user.tenantId },
      });
      if (!vehicle) return reply.code(404).send({ error: "Vehículo no encontrado" });
      return prisma.vehicleCommand.findMany({
        where: { tenantId: request.user.tenantId, vehicleId: id },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
    },
  );

  /**
   * Encender / apagar motor. El apagado exige vehículo detenido (interlock de
   * seguridad). Crea un comando PENDING que el dispositivo (o el simulador)
   * recoge y confirma.
   */
  app.post(
    "/vehicles/:id/commands",
    { preHandler: [requireModule("SAFETY"), requireRole("ADMIN", "DISPATCHER")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const input = vehicleCommandSchema.parse(request.body);
      const vehicle = await prisma.vehicle.findFirst({
        where: { id, tenantId: request.user.tenantId },
      });
      if (!vehicle) return reply.code(404).send({ error: "Vehículo no encontrado" });

      // Interlock de seguridad: nunca apagar un vehículo en movimiento.
      if (input.type === "ENGINE_OFF") {
        const speed = vehicle.lastSpeedKmh ?? 0;
        if (speed > 0.5) {
          return reply.code(422).send({
            error: `No se puede apagar el motor en movimiento (${speed.toFixed(0)} km/h). Solo con el vehículo detenido.`,
            code: "VEHICLE_IN_MOTION",
          });
        }
      }

      const command = await prisma.vehicleCommand.create({
        data: {
          tenantId: request.user.tenantId,
          vehicleId: id,
          type: input.type,
          status: "PENDING",
          requestedByUserId: request.user.sub,
          reason: input.reason,
        },
      });
      return reply.code(201).send(command);
    },
  );

  /**
   * Endpoint del dispositivo/simulador: reclama comandos pendientes de un
   * vehículo (los marca SENT) para ejecutarlos y luego confirmarlos.
   */
  app.post("/vehicles/:id/commands/poll", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const vehicle = await prisma.vehicle.findFirst({
      where: { id, tenantId: request.user.tenantId },
    });
    if (!vehicle) return reply.code(404).send({ error: "Vehículo no encontrado" });

    const pending = await prisma.vehicleCommand.findMany({
      where: { tenantId: request.user.tenantId, vehicleId: id, status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });
    if (pending.length > 0) {
      await prisma.vehicleCommand.updateMany({
        where: { id: { in: pending.map((c) => c.id) } },
        data: { status: "SENT" },
      });
    }
    return pending;
  });

  /** Acuse del dispositivo/simulador: confirma la ejecución de un comando. */
  app.post("/commands/:commandId/ack", async (request, reply) => {
    const { commandId } = z.object({ commandId: z.string() }).parse(request.params);
    const body = z
      .object({ accepted: z.boolean(), rejectionReason: z.string().optional() })
      .parse(request.body);

    const command = await prisma.vehicleCommand.findFirst({
      where: { id: commandId, tenantId: request.user.tenantId },
    });
    if (!command) return reply.code(404).send({ error: "Comando no encontrado" });

    const updated = await prisma.vehicleCommand.update({
      where: { id: commandId },
      data: {
        status: body.accepted ? "ACK" : "REJECTED",
        rejectionReason: body.accepted ? null : body.rejectionReason,
        ackAt: new Date(),
      },
    });

    // Reflejar el efecto del comando en el estado del vehículo.
    if (body.accepted) {
      const engineOff = command.type === "ENGINE_OFF";
      await prisma.vehicle.update({
        where: { id: command.vehicleId },
        data: {
          engineOn: !engineOff,
          immobilized: engineOff,
          ...(engineOff ? { lastSpeedKmh: 0 } : {}),
        },
      });
    }
    return updated;
  });
}
