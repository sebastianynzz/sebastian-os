import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { serviceSchema } from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../../plugins/auth.js";

/**
 * Catálogo de Servicios (D3): promesas de entrega con precio por parada y plazo
 * (SLA). Núcleo B2B (sin gating): base de la facturación y del seguimiento de
 * incumplimientos. Tenant-scoped; mutaciones solo ADMIN. Sin pagos → sin COD.
 */
export default async function servicesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request) =>
    prisma.service.findMany({
      where: { tenantId: request.user.tenantId },
      orderBy: { createdAt: "desc" },
    }),
  );

  app.post("/", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const input = serviceSchema.parse(request.body);
    try {
      const created = await prisma.service.create({
        data: { ...input, tenantId: request.user.tenantId },
      });
      return reply.code(201).send(created);
    } catch {
      return reply
        .code(409)
        .send({ error: "Ya existe un servicio con ese identificador" });
    }
  });

  app.patch("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const input = serviceSchema.partial().parse(request.body);
    const existing = await prisma.service.findFirst({
      where: { id, tenantId: request.user.tenantId },
    });
    if (!existing) return reply.code(404).send({ error: "Servicio no encontrado" });
    return prisma.service.update({ where: { id }, data: input });
  });

  app.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const existing = await prisma.service.findFirst({
      where: { id, tenantId: request.user.tenantId },
    });
    if (!existing) return reply.code(404).send({ error: "Servicio no encontrado" });
    await prisma.service.delete({ where: { id } });
    return reply.code(204).send();
  });
}
