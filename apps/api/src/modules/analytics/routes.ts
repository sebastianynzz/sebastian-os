import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { requireModule } from "../../plugins/entitlements.js";

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

  app.get("/notifications", async (request) => {
    return prisma.notificationLog.findMany({
      where: { tenantId: request.user.tenantId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  });
}
