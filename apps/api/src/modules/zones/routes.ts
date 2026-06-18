import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { zoneSchema } from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../../plugins/auth.js";

/**
 * Zonas de entrega (D5): polígonos geográficos con conductores asignados.
 * Núcleo (sin gating). Tenant-scoped; mutaciones solo ADMIN. Base de la
 * verificación de cobertura al crear pedidos (point-in-zone) y de la
 * preferencia de asignación por zona. Sin pagos.
 */
export default async function zonesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  /** Verifica que los conductores asignados pertenezcan al tenant (aislamiento). */
  async function driversValid(tenantId: string, driverIds: string[] | undefined) {
    if (!driverIds || driverIds.length === 0) return true;
    const unique = [...new Set(driverIds)];
    const count = await prisma.driver.count({
      where: { tenantId, id: { in: unique } },
    });
    return count === unique.length;
  }

  app.get("/", async (request) =>
    prisma.zone.findMany({
      where: { tenantId: request.user.tenantId },
      orderBy: { createdAt: "asc" },
    }),
  );

  app.post("/", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const input = zoneSchema.parse(request.body);
    const tenantId = request.user.tenantId;
    if (!(await driversValid(tenantId, input.driverIds))) {
      return reply.code(400).send({ error: "Conductor(es) no válido(s) para este tenant" });
    }
    const created = await prisma.zone.create({ data: { ...input, tenantId } });
    return reply.code(201).send(created);
  });

  app.patch("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const input = zoneSchema.partial().parse(request.body);
    const tenantId = request.user.tenantId;
    const existing = await prisma.zone.findFirst({ where: { id, tenantId } });
    if (!existing) return reply.code(404).send({ error: "Zona no encontrada" });
    if (input.driverIds && !(await driversValid(tenantId, input.driverIds))) {
      return reply.code(400).send({ error: "Conductor(es) no válido(s) para este tenant" });
    }
    return prisma.zone.update({ where: { id }, data: input });
  });

  app.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const existing = await prisma.zone.findFirst({
      where: { id, tenantId: request.user.tenantId },
    });
    if (!existing) return reply.code(404).send({ error: "Zona no encontrada" });
    await prisma.zone.delete({ where: { id } });
    return reply.code(204).send();
  });
}
