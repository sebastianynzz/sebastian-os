import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { registerAuth } from "./plugins/auth.js";
import authRoutes from "./modules/auth/routes.js";
import modulesRoutes from "./modules/admin/modules.js";
import ordersRoutes from "./modules/orders/routes.js";
import driversRoutes from "./modules/drivers/routes.js";
import vehiclesRoutes from "./modules/vehicles/routes.js";
import optimizationRoutes from "./modules/optimization/routes.js";
import routesRoutes from "./modules/routes/routes.js";
import codRoutes from "./modules/cod/routes.js";
import trackingRoutes from "./modules/tracking/routes.js";
import safetyRoutes from "./modules/safety/routes.js";
import evRoutes from "./modules/ev/routes.js";
import analyticsRoutes from "./modules/analytics/routes.js";

/**
 * Monolito modular: el núcleo (auth, pedidos, conductores, vehículos, rutas,
 * tracking) siempre se registra; los módulos de pago se registran detrás de
 * requireModule(<clave>) y devuelven 403 MODULE_NOT_ENABLED si el tenant no
 * los tiene activos.
 */
export async function buildApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test" && {
      transport: undefined,
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  await app.register(cors, { origin: true });
  await registerAuth(app);

  app.setErrorHandler((error: unknown, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "Datos inválidos",
        details: error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    const err = error as { statusCode?: number; message?: string };
    const statusCode =
      typeof err.statusCode === "number" ? err.statusCode : 500;
    if (statusCode >= 500) app.log.error(error);
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? "Error interno" : (err.message ?? "Error"),
    });
  });

  app.get("/health", async () => ({ ok: true, service: "moveos-api" }));

  // Núcleo
  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(modulesRoutes, { prefix: "/modules" });
  await app.register(ordersRoutes, { prefix: "/orders" });
  await app.register(driversRoutes, { prefix: "/drivers" });
  await app.register(vehiclesRoutes, { prefix: "/vehicles" });
  await app.register(routesRoutes, { prefix: "/routes" });
  await app.register(trackingRoutes, { prefix: "/tracking" });

  // Módulos activables
  await app.register(optimizationRoutes, { prefix: "/optimization" });
  await app.register(codRoutes, { prefix: "/cod" });
  await app.register(safetyRoutes, { prefix: "/safety" });
  await app.register(evRoutes, { prefix: "/ev" });
  await app.register(analyticsRoutes, { prefix: "/analytics" });

  return app;
}
