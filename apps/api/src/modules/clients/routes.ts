import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createClientSchema, updateClientSchema } from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../../plugins/auth.js";

/**
 * Negocios cliente del tenant (modelo B2B): las tiendas/distribuidores que
 * originan los envíos y reciben las confirmaciones de entrega. Forman parte
 * del núcleo — no requieren módulo de pago.
 */
export default async function clientsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request) => {
    return prisma.client.findMany({
      where: { tenantId: request.user.tenantId },
      orderBy: { name: "asc" },
      include: { _count: { select: { orders: true } } },
    });
  });

  app.get("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const client = await prisma.client.findFirst({
      where: { id, tenantId: request.user.tenantId },
      include: { _count: { select: { orders: true } } },
    });
    if (!client) return reply.code(404).send({ error: "Cliente no encontrado" });
    return client;
  });

  /** Confirmaciones enviadas a un negocio cliente (feed B2B). */
  app.get("/:id/notifications", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const client = await prisma.client.findFirst({
      where: { id, tenantId: request.user.tenantId },
    });
    if (!client) return reply.code(404).send({ error: "Cliente no encontrado" });
    return prisma.notificationLog.findMany({
      where: { tenantId: request.user.tenantId, clientId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  });

  app.post(
    "/",
    { preHandler: [requireRole("ADMIN", "DISPATCHER")] },
    async (request, reply) => {
      const input = createClientSchema.parse(request.body);
      const client = await prisma.client.create({
        data: {
          tenantId: request.user.tenantId,
          name: input.name,
          contactName: input.contactName,
          email: input.email || null,
          phone: input.phone || null,
          notifyChannel: input.notifyChannel,
          webhookUrl: input.webhookUrl || null,
        },
      });
      return reply.code(201).send(client);
    },
  );

  app.patch(
    "/:id",
    { preHandler: [requireRole("ADMIN", "DISPATCHER")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const input = updateClientSchema.parse(request.body);
      const existing = await prisma.client.findFirst({
        where: { id, tenantId: request.user.tenantId },
      });
      if (!existing) return reply.code(404).send({ error: "Cliente no encontrado" });
      return prisma.client.update({
        where: { id },
        data: {
          name: input.name,
          contactName: input.contactName,
          email: input.email === "" ? null : input.email,
          phone: input.phone,
          notifyChannel: input.notifyChannel,
          webhookUrl: input.webhookUrl === "" ? null : input.webhookUrl,
        },
      });
    },
  );
}
