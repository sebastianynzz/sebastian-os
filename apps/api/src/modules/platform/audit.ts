import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";

/** Consulta de la bitácora de auditoría del plano de plataforma. */
export default async function platformAuditRoutes(app: FastifyInstance) {
  app.get("/", async (request) => {
    const query = z
      .object({
        tenantId: z.string().optional(),
        take: z.coerce.number().int().min(1).max(200).default(50),
        cursor: z.string().optional(),
      })
      .parse(request.query);

    const entries = await prisma.platformAuditLog.findMany({
      where: query.tenantId ? { targetTenantId: query.tenantId } : {},
      orderBy: { createdAt: "desc" },
      take: query.take + 1, // una de más para saber si hay siguiente página
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = entries.length > query.take;
    const page = hasMore ? entries.slice(0, query.take) : entries;
    return {
      entries: page,
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  });
}
