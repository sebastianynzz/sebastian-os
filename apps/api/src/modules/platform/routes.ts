import type { FastifyInstance } from "fastify";
import platformAuthRoutes from "./auth.js";
import platformTenantsRoutes from "./tenants.js";
import platformTenantUsersRoutes from "./users.js";
import platformBillingRoutes from "./billing.js";
import platformMetricsRoutes from "./metrics.js";
import platformAuditRoutes from "./audit.js";
import platformFlywheelRoutes from "./flywheel.js";
import platformHealthRoutes from "./health.js";

/**
 * Plano del operador de plataforma: `/platform/*`. La autenticación
 * (`/platform/auth/login`) es pública; el resto exige `requirePlatformAdmin`.
 */
export default async function platformRoutes(app: FastifyInstance) {
  await app.register(platformAuthRoutes, { prefix: "/auth" });

  // Rutas protegidas: operador de plataforma.
  await app.register(async (protectedApp) => {
    protectedApp.addHook("preHandler", protectedApp.requirePlatformAdmin);
    await protectedApp.register(platformTenantsRoutes, { prefix: "/tenants" });
    await protectedApp.register(platformTenantUsersRoutes, {
      prefix: "/tenants/:id/users",
    });
    await protectedApp.register(platformBillingRoutes, {
      prefix: "/tenants/:id/invoices",
    });
    await protectedApp.register(platformMetricsRoutes, { prefix: "/metrics" });
    await protectedApp.register(platformAuditRoutes, { prefix: "/audit" });
    await protectedApp.register(platformFlywheelRoutes, { prefix: "/flywheel" });
    await protectedApp.register(platformHealthRoutes, { prefix: "/integrations" });
  });
}
