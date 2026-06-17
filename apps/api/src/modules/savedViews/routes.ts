import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createSavedViewSchema } from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";

/**
 * Vistas guardadas del panel (núcleo, no gateado): filtros con nombre por
 * página, PRIVADAS por usuario y tenant. Un despachador guarda "Pendientes
 * Bogotá hoy" y la reaplica luego. Todo se acota a request.user (tenant + sub).
 */
export default async function savedViewsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request) => {
    const { page } = z.object({ page: z.string().optional() }).parse(request.query);
    return prisma.savedView.findMany({
      where: {
        tenantId: request.user.tenantId,
        userId: request.user.sub,
        ...(page ? { page } : {}),
      },
      orderBy: { name: "asc" },
    });
  });

  app.post("/", async (request) => {
    const input = createSavedViewSchema.parse(request.body);
    // Re-guardar con el mismo nombre actualiza la vista (upsert por la clave única).
    return prisma.savedView.upsert({
      where: {
        tenantId_userId_page_name: {
          tenantId: request.user.tenantId,
          userId: request.user.sub,
          page: input.page,
          name: input.name,
        },
      },
      create: {
        tenantId: request.user.tenantId,
        userId: request.user.sub,
        page: input.page,
        name: input.name,
        filters: input.filters,
      },
      update: { filters: input.filters },
    });
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    // Solo borra vistas propias (acotado a usuario + tenant).
    const result = await prisma.savedView.deleteMany({
      where: { id, tenantId: request.user.tenantId, userId: request.user.sub },
    });
    if (result.count === 0) return reply.code(404).send({ error: "Vista no encontrada" });
    return { ok: true };
  });
}
