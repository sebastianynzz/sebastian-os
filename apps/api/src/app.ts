import { mkdirSync } from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { config } from "./config.js";
import { captureError } from "./lib/sentry.js";
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
import publicTrackingRoutes from "./modules/tracking/public.js";
import telematicsRoutes from "./modules/telematics/routes.js";
import uploadsRoutes from "./modules/uploads/routes.js";
import safetyRoutes from "./modules/safety/routes.js";
import { UPLOADS_DIR } from "./services/storage.js";
import evRoutes from "./modules/ev/routes.js";
import analyticsRoutes from "./modules/analytics/routes.js";
import addressesRoutes from "./modules/addresses/routes.js";
import exceptionsRoutes from "./modules/exceptions/routes.js";
import copilotRoutes from "./modules/copilot/routes.js";
import aiRoutes from "./modules/ai/routes.js";
import platformRoutes from "./modules/platform/routes.js";
import portalRoutes from "./modules/portal/routes.js";
import pushRoutes from "./modules/push/routes.js";
import realtimeRoutes from "./modules/realtime/routes.js";
import { closeAllStreams } from "./services/realtime.js";

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
  await app.register(multipart);
  // Evidencias subidas en desarrollo (en producción las sirve Supabase Storage).
  mkdirSync(UPLOADS_DIR, { recursive: true });
  await app.register(fastifyStatic, {
    root: UPLOADS_DIR,
    prefix: "/files/",
    decorateReply: false,
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
    if (statusCode >= 500) {
      app.log.error(error);
      captureError(error); // P0.7: no-op sin SENTRY_DSN
    }
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? "Error interno" : (err.message ?? "Error"),
    });
  });

  app.get("/health", async () => ({ ok: true, service: "moveos-api" }));

  // Rastreo público (SIN autenticación): el negocio cliente sigue su envío.
  await app.register(publicTrackingRoutes, { prefix: "/track" });

  // Núcleo
  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(modulesRoutes, { prefix: "/modules" });
  await app.register(ordersRoutes, { prefix: "/orders" });
  await app.register(clientsRoutes, { prefix: "/clients" });
  await app.register(driversRoutes, { prefix: "/drivers" });
  await app.register(vehiclesRoutes, { prefix: "/vehicles" });
  await app.register(routesRoutes, { prefix: "/routes" });
  await app.register(trackingRoutes, { prefix: "/tracking" });
  await app.register(uploadsRoutes, { prefix: "/uploads" });
  // Inteligencia de direcciones (triage + correcciones de pin) y cockpit de
  // excepciones: núcleo operativo, sin módulo de pago.
  await app.register(addressesRoutes, { prefix: "/addresses" });
  await app.register(exceptionsRoutes, { prefix: "/exceptions" });
  // Flota eléctrica: NÚCLEO (MoveOS es EV-only; restricción dura 1.3).
  // Autonomía, SoC y directorio de carga nunca se gatean por entitlement.
  await app.register(evRoutes, { prefix: "/ev" });
  // Web Push (VAPID): avisos instantáneos a conductor y despachador.
  await app.register(pushRoutes, { prefix: "/push" });

  // Portal de clientes (rol CLIENT): el negocio crea y sigue SUS envíos.
  await app.register(portalRoutes, { prefix: "/portal" });

  // Streams SSE de tiempo real (sustituyen el sondeo de los frontends).
  await app.register(realtimeRoutes, { prefix: "/realtime" });
  app.addHook("onClose", async () => closeAllStreams());

  // Módulos activables
  await app.register(optimizationRoutes, { prefix: "/optimization" });
  await app.register(telematicsRoutes, { prefix: "/telematics" });
  await app.register(safetyRoutes, { prefix: "/safety" });
  await app.register(analyticsRoutes, { prefix: "/analytics" });
  // Copiloto IA (módulo AI_ADDONS): narra y propone sobre sistemas existentes.
  await app.register(copilotRoutes, { prefix: "/copilot" });
  // Capa de optimización con IA (módulo AI_ADDONS): registro de acciones,
  // botones "Optimizar con IA" y ruta de aplicación auditada (run → apply).
  await app.register(aiRoutes, { prefix: "/ai" });

  // Plano del operador de plataforma (autenticación separada).
  await app.register(platformRoutes, { prefix: "/platform" });

  return app;
}
