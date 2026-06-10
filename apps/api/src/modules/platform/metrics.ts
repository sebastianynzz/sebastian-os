import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MODULE_CATALOG } from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import {
  getPlatformTimeseries,
  getTenantTimeseries,
  parseRange,
} from "../../services/dailyMetrics.js";

/** Métricas agregadas de toda la plataforma (operador). */
export default async function platformMetricsRoutes(app: FastifyInstance) {
  /**
   * Serie diaria: con `tenantId` la salud operativa de UN tenant (vista de
   * Customer Success); sin él, el agregado de toda la plataforma.
   */
  app.get("/timeseries", async (request, reply) => {
    const query = z
      .object({
        tenantId: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(request.query);
    const range = parseRange(query.from, query.to);
    if ("error" in range) return reply.code(400).send({ error: range.error });

    if (query.tenantId) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: query.tenantId },
        select: { id: true },
      });
      if (!tenant) return reply.code(404).send({ error: "Tenant no encontrado" });
      const days = await getTenantTimeseries(query.tenantId, range.from, range.to);
      return { tenantId: query.tenantId, from: range.from, to: range.to, days };
    }
    const days = await getPlatformTimeseries(range.from, range.to);
    return { from: range.from, to: range.to, days };
  });

  app.get("/", async () => {
    const [tenants, ordersTotal, delivered, attempted, byPlan, adoption, byDay] =
      await Promise.all([
        prisma.tenant.findMany({ select: { status: true } }),
        prisma.order.count(),
        prisma.order.count({ where: { status: "DELIVERED" } }),
        prisma.order.count({ where: { status: { in: ["DELIVERED", "FAILED", "REJECTED"] } } }),
        prisma.tenant.groupBy({ by: ["plan"], _count: { _all: true } }),
        prisma.moduleEntitlement.groupBy({
          by: ["moduleKey"],
          where: { enabled: true },
          _count: { _all: true },
        }),
        // Pedidos por día (últimos 14 días). count() devuelve BigInt → cast ::int.
        prisma.$queryRaw<{ day: string; count: number }[]>`
          SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
                 count(*)::int AS count
          FROM "Order"
          WHERE "createdAt" >= now() - interval '14 days'
          GROUP BY 1 ORDER BY 1
        `,
      ]);

    const tenantCount = tenants.length;
    const adoptionByKey = new Map(adoption.map((a) => [a.moduleKey, a._count._all]));

    return {
      tenants: {
        total: tenantCount,
        active: tenants.filter((t) => t.status === "ACTIVE").length,
        suspended: tenants.filter((t) => t.status === "SUSPENDED").length,
        byPlan: byPlan.map((p) => ({ plan: p.plan, count: p._count._all })),
      },
      orders: {
        total: ordersTotal,
        deliverySuccessRate: attempted === 0 ? null : delivered / attempted,
        byDay,
      },
      moduleAdoption: MODULE_CATALOG.map((m) => ({
        moduleKey: m.key,
        nombre: m.nombre,
        enabledCount: adoptionByKey.get(m.key) ?? 0,
        tenantCount,
      })),
    };
  });
}
