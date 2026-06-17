import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { depotSchema } from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../../plugins/auth.js";

/**
 * Depósitos / centros de distribución (D4 multi-depot): puntos de salida y
 * regreso de las rutas. Núcleo B2B (sin gating). Tenant-scoped; mutaciones solo
 * ADMIN. `isMain` marca el principal del tenant — se mantiene UNO por tenant.
 * ⚡ Base de FaaS multi-ciudad y de la planificación de carga por depósito.
 */
export default async function depotsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request) =>
    prisma.depot.findMany({
      where: { tenantId: request.user.tenantId },
      orderBy: [{ isMain: "desc" }, { createdAt: "asc" }],
    }),
  );

  app.post("/", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const input = depotSchema.parse(request.body);
    const tenantId = request.user.tenantId;
    const count = await prisma.depot.count({ where: { tenantId } });
    // El primer depósito siempre es el principal; si se pide isMain, se desmarca
    // el resto para conservar un único principal por tenant.
    const makeMain = input.isMain || count === 0;
    const created = await prisma.$transaction(async (tx) => {
      if (makeMain) {
        await tx.depot.updateMany({
          where: { tenantId, isMain: true },
          data: { isMain: false },
        });
      }
      return tx.depot.create({ data: { ...input, isMain: makeMain, tenantId } });
    });
    return reply.code(201).send(created);
  });

  app.patch("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const input = depotSchema.partial().parse(request.body);
    const tenantId = request.user.tenantId;
    const existing = await prisma.depot.findFirst({ where: { id, tenantId } });
    if (!existing) return reply.code(404).send({ error: "Depósito no encontrado" });
    const updated = await prisma.$transaction(async (tx) => {
      if (input.isMain === true) {
        await tx.depot.updateMany({
          where: { tenantId, isMain: true, NOT: { id } },
          data: { isMain: false },
        });
      }
      return tx.depot.update({ where: { id }, data: input });
    });
    return updated;
  });

  app.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const tenantId = request.user.tenantId;
    const existing = await prisma.depot.findFirst({ where: { id, tenantId } });
    if (!existing) return reply.code(404).send({ error: "Depósito no encontrado" });
    await prisma.$transaction(async (tx) => {
      await tx.depot.delete({ where: { id } });
      // Si se borró el principal, se promueve el más antiguo que quede para no
      // dejar al tenant sin depósito principal. Las rutas/conductores/vehículos
      // que lo referenciaban quedan con FK en null (ON DELETE SET NULL).
      if (existing.isMain) {
        const next = await tx.depot.findFirst({
          where: { tenantId },
          orderBy: { createdAt: "asc" },
        });
        if (next) await tx.depot.update({ where: { id: next.id }, data: { isMain: true } });
      }
    });
    return reply.code(204).send();
  });
}
