import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { addDays, todayBogota } from "../../services/dailyMetrics.js";

/**
 * Costo evitado por acierto del grafo. Tarifa de referencia de Google Geocoding
 * API (~USD 5 por 1000 solicitudes = USD 0.005 c/u, nivel estándar 2025);
 * conservadora (Lupap y los SKU rooftop cuestan más). Cada acierto del grafo es
 * una de estas llamadas que NO se pagó — la unit-economic central del moat.
 */
const COST_PER_GEOCODE_USD = 0.005;

/**
 * Monitor del data flywheel (operador de plataforma): el cuarto de máquinas
 * del moat. Mide si el grafo de direcciones está compounding:
 *
 *  - Crecimiento del grafo (pines nuevos por día/semana, por tenant).
 *  - Graph hit rate: % de geocodificaciones resueltas por el grafo — cada
 *    acierto es una llamada a Google/Lupap que NO se pagó (unit economics).
 *  - Cobertura por ciudad (¿dónde está aprendiendo la flota?).
 */
export default async function platformFlywheelRoutes(app: FastifyInstance) {
  app.get("/", async () => {
    const to = todayBogota();
    const from30 = addDays(to, -29);
    const from7 = addDays(to, -6);

    const [totalPins, pins30d, pins7d, byCity, byTenant, statRows, growthRows, lifetimeAgg] =
      await Promise.all([
        prisma.addressPin.count(),
        prisma.addressPin.count({
          where: { createdAt: { gte: new Date(`${from30}T05:00:00.000Z`) } },
        }),
        prisma.addressPin.count({
          where: { createdAt: { gte: new Date(`${from7}T05:00:00.000Z`) } },
        }),
        prisma.addressPin.groupBy({
          by: ["city"],
          _count: { _all: true },
          orderBy: { _count: { id: "desc" } },
        }),
        prisma.$queryRaw<
          { tenantId: string; name: string; pins: number; uses: number }[]
        >`
          SELECT p."tenantId", t.name, count(*)::int AS pins, sum(p."useCount")::int AS uses
          FROM "AddressPin" p JOIN "Tenant" t ON t.id = p."tenantId"
          GROUP BY 1, 2 ORDER BY pins DESC
        `,
        prisma.geocodeDailyStat.findMany({
          where: { date: { gte: from30, lte: to } },
        }),
        // Pines nuevos por día (crecimiento del grafo, 30 días).
        prisma.$queryRaw<{ day: string; count: number }[]>`
          SELECT ((("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota')::date)::text AS day,
                 count(*)::int AS count
          FROM "AddressPin"
          WHERE "createdAt" >= now() - interval '30 days'
          GROUP BY 1 ORDER BY 1
        `,
        // Reusos de por vida: cada incremento de useCount es un acierto del
        // grafo (una llamada paga evitada) acumulado en la vida del grafo.
        prisma.addressPin.aggregate({ _sum: { useCount: true } }),
      ]);

    // Graph hit rate de los últimos 30 días, agregado y por día.
    const bySource = new Map<string, number>();
    const byDay = new Map<string, { hits: number; total: number }>();
    for (const row of statRows) {
      bySource.set(row.source, (bySource.get(row.source) ?? 0) + row.count);
      const day = byDay.get(row.date) ?? { hits: 0, total: 0 };
      day.total += row.count;
      if (row.source === "ADDRESS_PIN") day.hits += row.count;
      byDay.set(row.date, day);
    }
    const totalGeocodes = [...bySource.values()].reduce((a, b) => a + b, 0);
    const graphHits = bySource.get("ADDRESS_PIN") ?? 0;
    const paidCalls = (bySource.get("GOOGLE") ?? 0) + (bySource.get("LUPAP") ?? 0);

    const growthMap = new Map(growthRows.map((r) => [r.day, r.count]));
    const round2 = (n: number) => Math.round(n * 100) / 100;
    // Reusos acumulados = aciertos del grafo de por vida = llamadas pagas
    // evitadas a lo largo de la vida del grafo (compounding del moat).
    const lifetimeReuses = lifetimeAgg._sum.useCount ?? 0;

    return {
      generatedAt: new Date().toISOString(),
      costPerGeocodeUsd: COST_PER_GEOCODE_USD,
      graph: {
        totalPins,
        newPins7d: pins7d,
        newPins30d: pins30d,
        lifetimeReuses,
        lifetimeSavingsUsd: round2(lifetimeReuses * COST_PER_GEOCODE_USD),
        byCity: byCity.map((c) => ({ city: c.city ?? "sin ciudad", pins: c._count._all })),
        byTenant,
      },
      geocoding30d: {
        total: totalGeocodes,
        graphHits,
        // Cada acierto del grafo es una llamada paga (Google/Lupap) evitada.
        paidCallsAvoided: graphHits,
        estimatedSavingsUsd: round2(graphHits * COST_PER_GEOCODE_USD),
        paidProviderCalls: paidCalls,
        mockCalls: bySource.get("MOCK") ?? 0,
        hitRate: totalGeocodes === 0 ? null : graphHits / totalGeocodes,
        bySource: [...bySource.entries()].map(([source, count]) => ({ source, count })),
      },
      daily: [...byDay.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([day, v]) => ({
          day,
          geocodes: v.total,
          graphHits: v.hits,
          hitRate: v.total === 0 ? null : v.hits / v.total,
          newPins: growthMap.get(day) ?? 0,
        })),
    };
  });
}
