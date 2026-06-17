import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { computeExceptions } from "../../services/exceptions.js";
import { prisma } from "../../lib/prisma.js";

/**
 * Cockpit de excepciones (núcleo): UNA cola priorizada con todo lo que exige
 * acción del despachador ahora — rutas tarde, vehículos sin señal, desvíos,
 * entregas fallidas por recuperar, EVs con batería baja y direcciones sin
 * confirmar. Es la pantalla de inicio operativa del día.
 *
 * Posponer ("snooze") oculta una excepción de la cola por un rato sin
 * resolverla: el aplazo se guarda por su `key` estable y la excepción se
 * recalcula en vivo, así que reaparece al expirar si la condición persiste.
 */

// Máximo duro de aplazo: 7 días (los presets de la UI son 1 h / 4 h / 1 día).
const MAX_SNOOZE_MIN = 7 * 24 * 60;

export default async function exceptionsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request) => {
    const tenantId = request.user.tenantId;
    const [items, snoozes] = await Promise.all([
      computeExceptions(tenantId),
      prisma.snoozedException.findMany({
        where: { tenantId, until: { gt: new Date() } },
        orderBy: { until: "asc" },
        select: { key: true, until: true },
      }),
    ]);
    return { generatedAt: new Date().toISOString(), items, snoozed: snoozes };
  });

  /** Posponer una excepción por `minutes`. Idempotente por (tenant, key). */
  app.post("/snooze", async (request, reply) => {
    const body = z
      .object({
        key: z.string().min(1).max(200),
        minutes: z.number().int().positive().max(MAX_SNOOZE_MIN),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "key y minutes (1–10080) requeridos" });
    }
    const { key, minutes } = body.data;
    const until = new Date(Date.now() + minutes * 60_000);
    const snooze = await prisma.snoozedException.upsert({
      where: { tenantId_key: { tenantId: request.user.tenantId, key } },
      create: {
        tenantId: request.user.tenantId,
        key,
        until,
        createdByUserId: request.user.sub,
      },
      update: { until, createdByUserId: request.user.sub },
      select: { key: true, until: true },
    });
    return snooze;
  });

  /** Reactivar una excepción pospuesta (quita el aplazo). */
  app.delete("/snooze/:key", async (request) => {
    const { key } = z.object({ key: z.string() }).parse(request.params);
    await prisma.snoozedException.deleteMany({
      where: { tenantId: request.user.tenantId, key },
    });
    return { ok: true };
  });
}
