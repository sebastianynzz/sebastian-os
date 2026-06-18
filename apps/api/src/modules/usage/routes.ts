import type { FastifyInstance } from "fastify";
import { planLimits } from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { bogotaUtcRange } from "../../services/dailyMetrics.js";
import { currentMonth } from "../../services/greenReport.js";

/**
 * Medición de uso + upsell (Tier 3 §12): uso del mes actual frente a los límites
 * del plan. Informativo (no bloquea la operación): el frontend muestra un banner
 * de upsell al acercarse o superar un límite. Tenant-scoped.
 */

/** Rango de días [from, to] (Bogotá) que cubre el mes "YYYY-MM". */
function monthDayBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  // Día 0 del mes siguiente = último día del mes (en UTC, solo para el número).
  const lastDay = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}

export default async function usageRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request) => {
    const tenantId = request.user.tenantId;
    const month = currentMonth();
    const { from, to } = monthDayBounds(month);
    const { start, end } = bogotaUtcRange(from, to);

    const [tenant, ordersThisMonth, customProperties, drivers] = await Promise.all([
      prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { plan: true },
      }),
      prisma.order.count({
        where: { tenantId, createdAt: { gte: start, lt: end } },
      }),
      prisma.customProperty.count({ where: { tenantId } }),
      prisma.driver.count({ where: { tenantId } }),
    ]);

    return {
      plan: tenant.plan,
      month,
      usage: { ordersThisMonth, customProperties, drivers },
      limits: planLimits(tenant.plan),
    };
  });
}
