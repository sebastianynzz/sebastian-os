import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { getVapidPublicKey } from "../../services/push.js";

/**
 * Suscripciones Web Push del personal del tenant (núcleo, sin módulo).
 * El navegador entrega el objeto PushSubscription; aquí se guarda atado al
 * usuario autenticado. CLIENT queda fuera por `authenticate` (fail-safe).
 */
export default async function pushRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  /** Clave pública VAPID (null = push no configurado en este entorno). */
  app.get("/vapid-key", async () => ({ publicKey: getVapidPublicKey() }));

  app.post("/subscriptions", async (request, reply) => {
    const body = z
      .object({
        endpoint: z.string().url().max(1024),
        keys: z.object({
          p256dh: z.string().min(1).max(512),
          auth: z.string().min(1).max(512),
        }),
        userAgent: z.string().max(512).optional(),
      })
      .parse(request.body);

    // Upsert por endpoint: si el navegador re-suscribe, se re-ata al usuario
    // actual del dispositivo (cambio de cuenta en el mismo teléfono).
    const sub = await prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: {
        tenantId: request.user.tenantId,
        userId: request.user.sub,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent: body.userAgent,
      },
      update: {
        tenantId: request.user.tenantId,
        userId: request.user.sub,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent: body.userAgent,
      },
    });
    return reply.code(201).send({ id: sub.id });
  });

  app.delete("/subscriptions", async (request) => {
    const body = z
      .object({ endpoint: z.string().url().max(1024) })
      .parse(request.body);
    // Solo la propia: el endpoint es secreto del dispositivo, pero igual se
    // limita al tenant/usuario por defensa en profundidad.
    await prisma.pushSubscription.deleteMany({
      where: {
        endpoint: body.endpoint,
        tenantId: request.user.tenantId,
        userId: request.user.sub,
      },
    });
    return { ok: true };
  });
}
