import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { config } from "./config.js";
import { registerAuth } from "./plugins/auth.js";
import authRoutes from "./modules/auth/routes.js";
import modulesRoutes from "./modules/admin/modules.js";
import ordersRoutes from "./modules/orders/routes.js";
import clientsRoutes from "./modules/clients/routes.js";
import driversRoutes from "./modules/drivers/routes.js";
import vehiclesRoutes from "./modules/vehicles/routes.js";
import optimizationRoutes from "./modules/optimization/routes.js";
import routesRoutes from "./modules/routes/routes.js";
import trackingRoutes from "./modules/tracking/routes.js";
import telematicsRoutes from "./modules/telematics/routes.js";
import safetyRoutes from "./modules/safety/routes.js";
import evRoutes from "./modules/ev/routes.js";
import analyticsRoutes from "./modules/analytics/routes.js";
import platformRoutes from "./modules/platform/routes.js";

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

  await app.register(helmet);
  // CORS restringido a orígenes conocidos (allowlist por entorno).
  await app.register(cors, {
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
  });
  // Límite de peticiones global; los endpoints sensibles lo endurecen aparte.
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
  });
  await registerAuth(app);

  // Los clientes de navegador envían Content-Type: application/json incluso en
  // POSTs sin cuerpo (p. ej. /routes/:id/start): tratar cuerpo vacío como {}.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, body, done) => {
      if (body === "" || body === undefined) return done(null, {});
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        done(err as Error);
      }
    },
  );

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
  await app.register(clientsRoutes, { prefix: "/clients" });
  await app.register(driversRoutes, { prefix: "/drivers" });
  await app.register(vehiclesRoutes, { prefix: "/vehicles" });
  await app.register(routesRoutes, { prefix: "/routes" });
  await app.register(trackingRoutes, { prefix: "/tracking" });

  // Módulos activables
  await app.register(optimizationRoutes, { prefix: "/optimization" });
  await app.register(telematicsRoutes, { prefix: "/telematics" });
  await app.register(safetyRoutes, { prefix: "/safety" });
  await app.register(evRoutes, { prefix: "/ev" });
  await app.register(analyticsRoutes, { prefix: "/analytics" });

  // Plano del operador de plataforma (autenticación separada).
  await app.register(platformRoutes, { prefix: "/platform" });

  return app;
}
