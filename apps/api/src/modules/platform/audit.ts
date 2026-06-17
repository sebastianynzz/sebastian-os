import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { addDays } from "../../services/dailyMetrics.js";

/** Consulta de la bitácora de auditoría del plano de plataforma. */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const filterSchema = z.object({
  tenantId: z.string().optional(),
  action: z.string().optional(),
  // Búsqueda libre sobre las columnas estructuradas (operador, acción, ids de
  // destino). Los detalles JSON se cubren con los filtros estructurados.
  q: z.string().optional(),
  from: z.string().regex(DAY_RE).optional(),
  to: z.string().regex(DAY_RE).optional(),
});
type Filters = z.infer<typeof filterSchema>;

/** Día Bogotá (UTC-5 fijo) → instante UTC de inicio. */
function bogotaDayStart(day: string): Date {
  return new Date(`${day}T00:00:00-05:00`);
}

function buildWhere(f: Filters): Prisma.PlatformAuditLogWhereInput {
  const where: Prisma.PlatformAuditLogWhereInput = {};
  if (f.tenantId) where.targetTenantId = f.tenantId;
  if (f.action) where.action = f.action;
  if (f.from || f.to) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (f.from) createdAt.gte = bogotaDayStart(f.from);
    if (f.to) createdAt.lt = bogotaDayStart(addDays(f.to, 1)); // [from, to] inclusivo
    where.createdAt = createdAt;
  }
  const q = f.q?.trim();
  if (q) {
    where.OR = [
      { adminEmail: { contains: q, mode: "insensitive" } },
      { action: { contains: q, mode: "insensitive" } },
      { targetTenantId: { contains: q, mode: "insensitive" } },
      { targetUserId: { contains: q, mode: "insensitive" } },
    ];
  }
  return where;
}

/** Una celda CSV: siempre entre comillas, con comillas internas escapadas. */
function csvCell(value: unknown): string {
  const s =
    value === null || value === undefined
      ? ""
      : value instanceof Date
        ? value.toISOString()
        : typeof value === "string"
          ? value
          : JSON.stringify(value);
  return `"${s.replace(/"/g, '""')}"`;
}

export default async function platformAuditRoutes(app: FastifyInstance) {
  app.get("/", async (request) => {
    const query = filterSchema
      .extend({
        take: z.coerce.number().int().min(1).max(200).default(50),
        cursor: z.string().optional(),
      })
      .parse(request.query);

    const where = buildWhere(query);
    const entries = await prisma.platformAuditLog.findMany({
      where,
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

  /** Exporta la bitácora filtrada como CSV (mismos filtros que la lista). */
  app.get("/export", async (request, reply) => {
    const query = filterSchema.parse(request.query);
    const rows = await prisma.platformAuditLog.findMany({
      where: buildWhere(query),
      orderBy: { createdAt: "desc" },
      take: 5000,
    });
    const header = ["fecha", "accion", "operador", "tenant", "usuario", "detalle"];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          csvCell(r.createdAt),
          csvCell(r.action),
          csvCell(r.adminEmail),
          csvCell(r.targetTenantId),
          csvCell(r.targetUserId),
          csvCell(r.details),
        ].join(","),
      );
    }
    const filename = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
    reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${filename}"`);
    // BOM para que Excel reconozca UTF-8 (acentos en español).
    return "﻿" + lines.join("\n");
  });
}
