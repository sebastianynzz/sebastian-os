import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";

/**
 * Onboarding guiado (Tier 3 §14): lista de primeros pasos calculada del estado
 * real del tenant (depósito, vehículo, conductor, primer pedido, datos de
 * facturación). Alimenta la pantalla "Primeros pasos" + el conectar la app del
 * conductor. Tenant-scoped; solo lectura.
 */
export default async function onboardingRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/checklist", async (request) => {
    const tenantId = request.user.tenantId;
    const [depots, vehicles, drivers, orders, tenant] = await Promise.all([
      prisma.depot.count({ where: { tenantId } }),
      prisma.vehicle.count({ where: { tenantId } }),
      prisma.driver.count({ where: { tenantId } }),
      prisma.order.count({ where: { tenantId } }),
      prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { legalName: true, nit: true },
      }),
    ]);

    const steps = [
      { key: "depot", done: depots > 0 },
      { key: "vehicle", done: vehicles > 0 },
      { key: "driver", done: drivers > 0 },
      { key: "order", done: orders > 0 },
      { key: "billing", done: Boolean(tenant.legalName || tenant.nit) },
    ];
    return {
      steps,
      completed: steps.filter((s) => s.done).length,
      total: steps.length,
    };
  });
}
