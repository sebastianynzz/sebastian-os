import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { apiKeySchema, webhookSchema, webhookUpdateSchema } from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../../plugins/auth.js";
import { deliverWebhook, generateWebhookSecret } from "../../services/webhooks.js";
import { generateApiKey } from "../../services/apiKeys.js";

const apiKeyView = {
  id: true,
  name: true,
  prefix: true,
  scopes: true,
  lastUsedAt: true,
  createdAt: true,
} as const;

/**
 * Plataforma de desarrolladores (Tier 2 §8): gestión de webhooks del tenant
 * suscritos a eventos del ciclo de vida. El secreto se genera en el servidor y
 * se usa para firmar cada entrega (HMAC-SHA256). Núcleo (sin gating).
 * Tenant-scoped; mutaciones solo ADMIN.
 */
export default async function developerRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/webhooks", async (request) =>
    prisma.webhook.findMany({
      where: { tenantId: request.user.tenantId },
      orderBy: { createdAt: "desc" },
    }),
  );

  app.post("/webhooks", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const input = webhookSchema.parse(request.body);
    const created = await prisma.webhook.create({
      data: { ...input, tenantId: request.user.tenantId, secret: generateWebhookSecret() },
    });
    return reply.code(201).send(created);
  });

  app.patch("/webhooks/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const input = webhookUpdateSchema.parse(request.body);
    const existing = await prisma.webhook.findFirst({
      where: { id, tenantId: request.user.tenantId },
    });
    if (!existing) return reply.code(404).send({ error: "Webhook no encontrado" });
    return prisma.webhook.update({ where: { id }, data: input });
  });

  app.delete("/webhooks/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const existing = await prisma.webhook.findFirst({
      where: { id, tenantId: request.user.tenantId },
    });
    if (!existing) return reply.code(404).send({ error: "Webhook no encontrado" });
    await prisma.webhook.delete({ where: { id } });
    return reply.code(204).send();
  });

  /** Envía un evento de prueba firmado al webhook para validar la integración. */
  app.post("/webhooks/:id/test", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const hook = await prisma.webhook.findFirst({
      where: { id, tenantId: request.user.tenantId },
    });
    if (!hook) return reply.code(404).send({ error: "Webhook no encontrado" });
    const result = await deliverWebhook(hook, "DELIVERED", {
      test: true,
      guia: "DG-TEST",
      message: "Webhook de prueba de daleGo",
    });
    return { ok: result.ok, status: result.status };
  });

  // --- API keys: nunca se devuelve el hash; la key en claro se ve una vez. ---

  app.get("/api-keys", async (request) =>
    prisma.apiKey.findMany({
      where: { tenantId: request.user.tenantId },
      orderBy: { createdAt: "desc" },
      select: apiKeyView,
    }),
  );

  app.post("/api-keys", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const input = apiKeySchema.parse(request.body);
    const { plaintext, prefix, hashedKey } = generateApiKey();
    const created = await prisma.apiKey.create({
      data: { ...input, tenantId: request.user.tenantId, prefix, hashedKey },
      select: apiKeyView,
    });
    // La key en claro solo se muestra ahora; después solo queda el prefijo.
    return reply.code(201).send({ ...created, key: plaintext });
  });

  app.delete("/api-keys/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const existing = await prisma.apiKey.findFirst({
      where: { id, tenantId: request.user.tenantId },
    });
    if (!existing) return reply.code(404).send({ error: "API key no encontrada" });
    await prisma.apiKey.delete({ where: { id } });
    return reply.code(204).send();
  });
}
