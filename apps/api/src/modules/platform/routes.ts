import type { FastifyInstance } from "fastify";
import platformAuthRoutes from "./auth.js";
import platformTenantsRoutes from "./tenants.js";
import platformMetricsRoutes from "./metrics.js";

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
    await protectedApp.register(platformMetricsRoutes, { prefix: "/metrics" });
  });
}
