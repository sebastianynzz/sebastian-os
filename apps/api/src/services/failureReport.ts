import { FAIL_REASONS, type FailReason } from "@moveos/shared";
import { prisma } from "../lib/prisma.js";
import { bogotaUtcRange, eachDay } from "./dailyMetrics.js";

/**
 * Análisis de entregas fallidas (D6): agrega los pedidos FAILED/REJECTED del
 * rango por motivo estandarizado y por día. DIRECCION_ERRADA conecta con el
 * relato del grafo de direcciones (moat). Tenant-scoped; ventana por createdAt
 * (coherente con los demás informes).
 */

export interface FailureReport {
  from: string;
  to: string;
  total: number;
  byReason: { reason: FailReason; count: number; pct: number }[];
  byDay: { day: string; count: number }[];
}

/** Día calendario en America/Bogotá (UTC-5 fijo) de un instante UTC. */
function bogotaDay(d: Date): string {
  return new Date(d.getTime() - 5 * 3600_000).toISOString().slice(0, 10);
}

export async function tenantFailureReport(
  tenantId: string,
  from: string,
  to: string,
): Promise<FailureReport> {
  const { start, end } = bogotaUtcRange(from, to);
  const orders = await prisma.order.findMany({
    where: {
      tenantId,
      status: { in: ["FAILED", "REJECTED"] },
      createdAt: { gte: start, lt: end },
    },
    select: { failureReason: true, createdAt: true },
  });

  const counts = new Map<FailReason, number>();
  const dayCounts = new Map<string, number>();
  for (const o of orders) {
    const reason: FailReason = (FAIL_REASONS as readonly string[]).includes(
      o.failureReason ?? "",
    )
      ? (o.failureReason as FailReason)
      : "OTRO";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
    const day = bogotaDay(o.createdAt);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }

  const total = orders.length;
  const byReason = FAIL_REASONS.map((reason) => ({
    reason,
    count: counts.get(reason) ?? 0,
  }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((r) => ({ ...r, pct: total === 0 ? 0 : r.count / total }));
  const byDay = eachDay(from, to).map((day) => ({
    day,
    count: dayCounts.get(day) ?? 0,
  }));

  return { from, to, total, byReason, byDay };
}
