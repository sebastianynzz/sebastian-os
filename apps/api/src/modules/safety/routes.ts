import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireModule } from "../../plugins/entitlements.js";
import { emitTenant } from "../../services/realtime.js";

/**
 * Módulo de seguridad de carga (piratería terrestre): botón de pánico,
 * alertas de desviación (generadas por tracking) y su gestión.
 */
export default async function safetyRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.addHook("preHandler", requireModule("SAFETY"));

  /** Botón de pánico desde la app del conductor. */
  app.post("/panic", async (request, reply) => {
    const body = z
      .object({
        lat: z.number().optional(),
        lng: z.number().optional(),
        routeId: z.string().optional(),
        details: z.string().optional(),
      })
      .parse(request.body);

    const alert = await prisma.safetyAlert.create({
      data: {
        tenantId: request.user.tenantId,
        driverId: request.user.driverId,
        routeId: body.routeId,
        type: "PANIC",
        lat: body.lat,
        lng: body.lng,
        details: body.details ?? "Botón de pánico activado",
      },
    });
    // Producción: aquí se dispara llamada/SMS a central de monitoreo y PONAL.
    // Tiempo real: la central de monitoreo lo ve sin esperar el sondeo.
    emitTenant(request.user.tenantId, "safety", {
      alertId: alert.id,
      type: alert.type,
      status: alert.status,
    });
    return reply.code(201).send(alert);
  });

  app.get("/alerts", async (request) => {
    const query = z.object({ status: z.string().optional() }).parse(request.query);
    return prisma.safetyAlert.findMany({
      where: {
        tenantId: request.user.tenantId,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  });

  app.patch("/alerts/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({ status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED", "FALSE_ALARM"]) })
      .parse(request.body);
    const alert = await prisma.safetyAlert.findFirst({
      where: { id, tenantId: request.user.tenantId },
    });
    if (!alert) return reply.code(404).send({ error: "Alerta no encontrada" });
    const updated = await prisma.safetyAlert.update({
      where: { id },
      data: { status: body.status },
    });
    emitTenant(request.user.tenantId, "safety", {
      alertId: updated.id,
      type: updated.type,
      status: updated.status,
    });
    return updated;
  });
}
