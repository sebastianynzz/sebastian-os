import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireModule } from "../../plugins/entitlements.js";
import {
  getTenantTimeseries,
  parseRange,
} from "../../services/dailyMetrics.js";
import {
  currentMonth,
  MONTH_RE,
  tenantGreenReport,
} from "../../services/greenReport.js";
import { tenantSlaReport } from "../../services/slaReport.js";

/** Módulo Analítica Pro: KPIs operativos y financieros. */
export default async function analyticsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.addHook("preHandler", requireModule("ANALYTICS_PRO"));

  app.get("/summary", async (request) => {
    const tenantId = request.user.tenantId;

    const ordersByStatus = await prisma.order.groupBy({
      by: ["status"],
      where: { tenantId },
      _count: { _all: true },
    });

    const delivered = ordersByStatus.find((s) => s.status === "DELIVERED")?._count._all ?? 0;
    const failed = ordersByStatus.find((s) => s.status === "FAILED")?._count._all ?? 0;
    const rejected = ordersByStatus.find((s) => s.status === "REJECTED")?._count._all ?? 0;
    const attempted = delivered + failed + rejected;

    const routes = await prisma.route.aggregate({
      where: { tenantId },
      _sum: { totalDistanceKm: true },
      _count: { _all: true },
    });

    const totalStops = await prisma.routeStop.count({
      where: { route: { tenantId } },
    });
    const routeDuration = await prisma.route.aggregate({
      where: { tenantId },
      _sum: { totalDurationMin: true },
    });
    const routeHours = (routeDuration._sum.totalDurationMin ?? 0) / 60;

    const totalDistanceKm = routes._sum.totalDistanceKm ?? 0;
    return {
      ordersByStatus: ordersByStatus.map((s) => ({ status: s.status, count: s._count._all })),
      deliverySuccessRate: attempted === 0 ? null : delivered / attempted,
      routesPlanned: routes._count._all,
      // Métricas de productividad estilo TMS: paradas por ruta y por hora.
      stopsPerRoute:
        routes._count._all === 0
          ? null
          : Number((totalStops / routes._count._all).toFixed(1)),
      stopsPerHour:
        routeHours === 0 ? null : Number((totalStops / routeHours).toFixed(1)),
      totalDistanceKm,
      // Aproximación CO2: 0.12 kg/km flota mixta urbana (argumento de venta sostenibilidad).
      estimatedCo2Kg: Number((totalDistanceKm * 0.12).toFixed(1)),
    };
  });

  /**
   * Serie diaria (rollup DailyTenantMetric, refresco perezoso): pedidos,
   * entregas, rutas, distancia, CO₂ y tasa de éxito por día. Por defecto los
   * últimos 30 días; máximo 92.
   */
  app.get("/timeseries", async (request, reply) => {
    const query = z
      .object({ from: z.string().optional(), to: z.string().optional() })
      .parse(request.query);
    const range = parseRange(query.from, query.to);
    if ("error" in range) return reply.code(400).send({ error: range.error });

    const days = await getTenantTimeseries(
      request.user.tenantId,
      range.from,
      range.to,
    );
    return { from: range.from, to: range.to, days };
  });

  /**
   * Informe verde mensual del tenant: CO₂ por flota, tipo de vehículo y
   * negocio cliente — listo para enviar como argumento ESG a cada cliente.
   */
  app.get("/green-report", async (request) => {
    const query = z
      .object({ month: z.string().regex(MONTH_RE).optional() })
      .parse(request.query);
    return tenantGreenReport(
      request.user.tenantId,
      query.month ?? currentMonth(),
    );
  });

  /**
   * Cumplimiento de SLA por negocio cliente: para los pedidos con un Service en
   * el rango (por defecto 30 días), cuántos se entregaron a tiempo, cuántos
   * incumplieron y cuántos siguen en curso. Base del seguimiento de SLA y de la
   * facturación B2B. La hora límite es determinista (`slaDueAt`).
   */
  app.get("/sla-report", async (request, reply) => {
    const query = z
      .object({ from: z.string().optional(), to: z.string().optional() })
      .parse(request.query);
    const range = parseRange(query.from, query.to);
    if ("error" in range) return reply.code(400).send({ error: range.error });
    return tenantSlaReport(request.user.tenantId, range.from, range.to);
  });

  app.get("/notifications", async (request) => {
    return prisma.notificationLog.findMany({
      where: { tenantId: request.user.tenantId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  });
}
