import { co2BaselineKgForKm, co2KgForKm, type VehicleType } from "@moveos/shared";
import { prisma } from "../lib/prisma.js";

/**
 * Rollups diarios de métricas por tenant (`DailyTenantMetric`).
 *
 * Estrategia (ver docs/planning/ANALYTICS_ARCHITECTURE.md): materialización
 * perezosa al leer. `recomputeDailyMetrics` es determinista e idempotente —
 * recalcula un rango completo desde Order/Route/RouteStop y hace upsert por
 * (tenantId, date) — así que sirve igual para backfill, corrección histórica
 * y, cuando exista una cola de trabajos, como job nocturno sin cambios.
 *
 * El día se corta en America/Bogota (UTC-5 fijo, sin horario de verano):
 * los timestamps UTC se convierten antes de agrupar; Route.date ya es día local.
 */

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const BOGOTA_UTC_OFFSET = "-05:00";

/** Día actual en Bogotá (UTC-5 fijo). */
export function todayBogota(): string {
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

/** Instantes UTC que delimitan [from 00:00, to 24:00) en hora de Bogotá. */
export function bogotaUtcRange(from: string, to: string) {
  return {
    start: new Date(`${from}T00:00:00${BOGOTA_UTC_OFFSET}`),
    end: new Date(`${addDays(to, 1)}T00:00:00${BOGOTA_UTC_OFFSET}`),
  };
}

interface DayBucket {
  ordersCreated: number;
  ordersDelivered: number;
  ordersFailed: number;
  routesPlanned: number;
  stopsCompleted: number;
  totalDistanceKm: number;
  totalDurationMin: number;
  activeDrivers: number;
  co2Kg: number;
  co2SavedKg: number;
}

function emptyBucket(): DayBucket {
  return {
    ordersCreated: 0,
    ordersDelivered: 0,
    ordersFailed: 0,
    routesPlanned: 0,
    stopsCompleted: 0,
    totalDistanceKm: 0,
    totalDurationMin: 0,
    activeDrivers: 0,
    co2Kg: 0,
    co2SavedKg: 0,
  };
}

/**
 * Recalcula y persiste el rango completo [from, to] de un tenant. Idempotente:
 * dos llamadas seguidas producen exactamente las mismas filas (incluidos los
 * días en cero, para que la lectura perezosa los reconozca como calculados).
 */
export async function recomputeDailyMetrics(
  tenantId: string,
  from: string,
  to: string,
): Promise<void> {
  const { start, end } = bogotaUtcRange(from, to);

  // count() devuelve BigInt → cast ::int (mismo patrón que platform/metrics).
  const [created, delivered, failedStops, completedStops, routes] =
    await Promise.all([
      prisma.$queryRaw<{ day: string; count: number }[]>`
        SELECT ((("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota')::date)::text AS day,
               count(*)::int AS count
        FROM "Order"
        WHERE "tenantId" = ${tenantId}
          AND "createdAt" >= ${start} AND "createdAt" < ${end}
        GROUP BY 1
      `,
      prisma.$queryRaw<{ day: string; count: number }[]>`
        SELECT ((("deliveredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota')::date)::text AS day,
               count(*)::int AS count
        FROM "Order"
        WHERE "tenantId" = ${tenantId} AND status = 'DELIVERED'
          AND "deliveredAt" >= ${start} AND "deliveredAt" < ${end}
        GROUP BY 1
      `,
      // Intentos de entrega fallidos (cubre pedidos FAILED y REJECTED: ambos
      // nacen de una parada FAILED con completedAt).
      prisma.$queryRaw<{ day: string; count: number }[]>`
        SELECT (((s."completedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota')::date)::text AS day,
               count(*)::int AS count
        FROM "RouteStop" s
        JOIN "Route" r ON r.id = s."routeId"
        WHERE r."tenantId" = ${tenantId} AND s.status = 'FAILED'
          AND s."completedAt" >= ${start} AND s."completedAt" < ${end}
        GROUP BY 1
      `,
      prisma.$queryRaw<{ day: string; count: number }[]>`
        SELECT (((s."completedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota')::date)::text AS day,
               count(*)::int AS count
        FROM "RouteStop" s
        JOIN "Route" r ON r.id = s."routeId"
        WHERE r."tenantId" = ${tenantId} AND s.status = 'COMPLETED'
          AND s."completedAt" >= ${start} AND s."completedAt" < ${end}
        GROUP BY 1
      `,
      // Route.date ya es día local: distancia, duración, CO₂ y conductores.
      prisma.route.findMany({
        where: {
          tenantId,
          date: { gte: from, lte: to },
          status: { not: "CANCELLED" },
        },
        select: {
          date: true,
          driverId: true,
          totalDistanceKm: true,
          totalDurationMin: true,
          vehicle: { select: { type: true, isElectric: true } },
        },
      }),
    ]);

  const buckets = new Map<string, DayBucket>(
    eachDay(from, to).map((d) => [d, emptyBucket()]),
  );
  const pick = (day: string) => buckets.get(day);

  for (const r of created) {
    const b = pick(r.day);
    if (b) b.ordersCreated = r.count;
  }
  for (const r of delivered) {
    const b = pick(r.day);
    if (b) b.ordersDelivered = r.count;
  }
  for (const r of failedStops) {
    const b = pick(r.day);
    if (b) b.ordersFailed = r.count;
  }
  for (const r of completedStops) {
    const b = pick(r.day);
    if (b) b.stopsCompleted = r.count;
  }

  const driversByDay = new Map<string, Set<string>>();
  for (const route of routes) {
    const b = pick(route.date);
    if (!b) continue;
    const type = route.vehicle.type as VehicleType;
    const co2 = co2KgForKm(type, route.vehicle.isElectric, route.totalDistanceKm);
    const baseline = co2BaselineKgForKm(type, route.totalDistanceKm);
    b.routesPlanned += 1;
    b.totalDistanceKm += route.totalDistanceKm;
    b.totalDurationMin += route.totalDurationMin;
    b.co2Kg += co2;
    b.co2SavedKg += Math.max(baseline - co2, 0);
    if (route.driverId) {
      const set = driversByDay.get(route.date) ?? new Set<string>();
      set.add(route.driverId);
      driversByDay.set(route.date, set);
    }
  }
  for (const [day, drivers] of driversByDay) {
    const b = pick(day);
    if (b) b.activeDrivers = drivers.size;
  }

  const round = (n: number) => Number(n.toFixed(2));
  await prisma.$transaction(
    [...buckets.entries()].map(([date, b]) =>
      prisma.dailyTenantMetric.upsert({
        where: { tenantId_date: { tenantId, date } },
        create: {
          tenantId,
          date,
          ...b,
          totalDistanceKm: round(b.totalDistanceKm),
          co2Kg: round(b.co2Kg),
          co2SavedKg: round(b.co2SavedKg),
        },
        update: {
          ...b,
          totalDistanceKm: round(b.totalDistanceKm),
          co2Kg: round(b.co2Kg),
          co2SavedKg: round(b.co2SavedKg),
        },
      }),
    ),
  );
}

/**
 * Garantiza frescura perezosa: recalcula los días del rango que aún no tienen
 * fila, y siempre ayer + hoy (la historia cerrada es inmutable; el presente no).
 */
async function ensureFresh(tenantId: string, from: string, to: string) {
  const days = eachDay(from, to);
  const existing = await prisma.dailyTenantMetric.findMany({
    where: { tenantId, date: { gte: from, lte: to } },
    select: { date: true },
  });
  const have = new Set(existing.map((r) => r.date));
  const hasMissing = days.some((d) => !have.has(d));

  if (hasMissing) {
    // Backfill del rango completo en la primera lectura.
    await recomputeDailyMetrics(tenantId, from, to);
    return;
  }
  const today = todayBogota();
  const refreshFrom = addDays(today, -1);
  const lo = refreshFrom > from ? refreshFrom : from;
  const hi = today < to ? today : to;
  if (lo <= hi) await recomputeDailyMetrics(tenantId, lo, hi);
}

export interface DailyMetricPoint extends DayBucket {
  date: string;
  /** DELIVERED / (DELIVERED + intentos fallidos); null sin intentos. */
  successRate: number | null;
}

function toPoint(date: string, b: DayBucket): DailyMetricPoint {
  const attempted = b.ordersDelivered + b.ordersFailed;
  return {
    date,
    ...b,
    successRate: attempted === 0 ? null : b.ordersDelivered / attempted,
  };
}

/** Serie diaria densa (con ceros) de un tenant, refrescada perezosamente. */
export async function getTenantTimeseries(
  tenantId: string,
  from: string,
  to: string,
): Promise<DailyMetricPoint[]> {
  await ensureFresh(tenantId, from, to);
  const rows = await prisma.dailyTenantMetric.findMany({
    where: { tenantId, date: { gte: from, lte: to } },
    orderBy: { date: "asc" },
  });
  const byDate = new Map(rows.map((r) => [r.date, r]));
  return eachDay(from, to).map((date) => {
    const r = byDate.get(date);
    return toPoint(
      date,
      r
        ? {
            ordersCreated: r.ordersCreated,
            ordersDelivered: r.ordersDelivered,
            ordersFailed: r.ordersFailed,
            routesPlanned: r.routesPlanned,
            stopsCompleted: r.stopsCompleted,
            totalDistanceKm: r.totalDistanceKm,
            totalDurationMin: r.totalDurationMin,
            activeDrivers: r.activeDrivers,
            co2Kg: r.co2Kg,
            co2SavedKg: r.co2SavedKg,
          }
        : emptyBucket(),
    );
  });
}

/** Serie diaria agregada de toda la plataforma (suma de todos los tenants). */
export async function getPlatformTimeseries(
  from: string,
  to: string,
): Promise<DailyMetricPoint[]> {
  // Recompute perezoso por tenant: correcto a decenas de tenants. Cuando la
  // primera lectura del día se vuelva lenta (~100 tenants), mover a un job
  // programado — misma función, otro disparador.
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  for (const t of tenants) await ensureFresh(t.id, from, to);

  const grouped = await prisma.dailyTenantMetric.groupBy({
    by: ["date"],
    where: { date: { gte: from, lte: to } },
    _sum: {
      ordersCreated: true,
      ordersDelivered: true,
      ordersFailed: true,
      routesPlanned: true,
      stopsCompleted: true,
      totalDistanceKm: true,
      totalDurationMin: true,
      activeDrivers: true,
      co2Kg: true,
      co2SavedKg: true,
    },
  });
  const byDate = new Map(grouped.map((g) => [g.date, g._sum]));
  return eachDay(from, to).map((date) => {
    const s = byDate.get(date);
    const b: DayBucket = {
      ordersCreated: s?.ordersCreated ?? 0,
      ordersDelivered: s?.ordersDelivered ?? 0,
      ordersFailed: s?.ordersFailed ?? 0,
      routesPlanned: s?.routesPlanned ?? 0,
      stopsCompleted: s?.stopsCompleted ?? 0,
      totalDistanceKm: s?.totalDistanceKm ?? 0,
      totalDurationMin: s?.totalDurationMin ?? 0,
      activeDrivers: s?.activeDrivers ?? 0,
      co2Kg: s?.co2Kg ?? 0,
      co2SavedKg: s?.co2SavedKg ?? 0,
    };
    return toPoint(date, b);
  });
}

/** Rango por defecto: últimos `days` días terminando hoy (Bogotá). */
export function defaultRange(days: number): { from: string; to: string } {
  const to = todayBogota();
  return { from: addDays(to, -(days - 1)), to };
}

/** Valida y normaliza un rango pedido por la API (máx. 92 días). */
export function parseRange(
  from: string | undefined,
  to: string | undefined,
  fallbackDays = 30,
): { from: string; to: string } | { error: string } {
  if (!from && !to) return defaultRange(fallbackDays);
  if (!from || !to) return { error: "Indique from y to (YYYY-MM-DD), o ninguno" };
  if (!DAY_RE.test(from) || !DAY_RE.test(to)) {
    return { error: "Formato de fecha inválido (YYYY-MM-DD)" };
  }
  if (from > to) return { error: "from debe ser <= to" };
  if (eachDay(from, to).length > 92) return { error: "Rango máximo: 92 días" };
  return { from, to };
}
