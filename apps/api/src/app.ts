import { mkdirSync } from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
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
import evidenceRoutes from "./modules/uploads/evidence.js";
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
import savedViewsRoutes from "./modules/savedViews/routes.js";
import controlsRoutes from "./modules/controls/routes.js";
import servicesRoutes from "./modules/services/routes.js";
import depotsRoutes from "./modules/depots/routes.js";
import zonesRoutes from "./modules/zones/routes.js";
import developerRoutes from "./modules/developer/routes.js";
import ingestRoutes from "./modules/ingest/routes.js";
import customPropertiesRoutes from "./modules/customProperties/routes.js";
import usageRoutes from "./modules/usage/routes.js";
import onboardingRoutes from "./modules/onboarding/routes.js";
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
    // Detrás del edge de Render: usar X-Forwarded-For como IP real del cliente,
    // para que el rate-limit (y los logs) identifiquen al cliente y no al proxy.
    trustProxy: true,
  });

  // Cabeceras de seguridad (helmet por defecto) + HSTS a 1 año con preload.
  await app.register(helmet, {
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  });
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
  // Topes globales de multipart (DoS): cualquier consumidor multipart hereda
  // estos límites; las rutas que necesiten otro tope lo fijan aparte.
  await app.register(multipart, {
    limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 20, parts: 25 },
  });
  // Directorio local de evidencias (dev/self-host). Las fotos de POD son PII:
  // ya NO se sirven por estático público — se entregan por `/evidence` con URL
  // firmada y de corta duración (ver modules/uploads/evidence.ts). En producción
  // viven en un bucket PRIVADO de Supabase y se obtienen con la service-role.
  mkdirSync(UPLOADS_DIR, { recursive: true });
  await registerAuth(app);

  // Por defecto, ninguna respuesta de la API es cacheable por una caché
  // compartida o el navegador (datos por-tenant / PII / token-keyed). Las rutas
  // que sí deban cachear algo fijan su propio Cache-Control y este hook lo
  // respeta. Cubre el rastreo público (PII + GPS) y evita el back-button leak.
  app.addHook("onSend", async (_request, reply, payload) => {
    if (!reply.hasHeader("cache-control")) {
      reply.header("Cache-Control", "no-store");
    }
    return payload;
  });

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

  // Evidencia POD por URL firmada (SIN auth Bearer; la firma HMAC autoriza).
  // Sustituye la URL pública permanente del bucket por una de corta duración.
  await app.register(evidenceRoutes);

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
  // Controles del tenant (núcleo): política POD configurable por tipo.
  await app.register(controlsRoutes, { prefix: "/controls" });
  // Catálogo de servicios / SLA (núcleo B2B): base de facturación y SLA.
  await app.register(servicesRoutes, { prefix: "/services" });
  // Depósitos / multi-depot (núcleo): salida y regreso de rutas por depósito.
  await app.register(depotsRoutes, { prefix: "/depots" });
  // Zonas de entrega (núcleo): polígonos geográficos + conductores asignados.
  await app.register(zonesRoutes, { prefix: "/zones" });
  // Plataforma de desarrolladores (Tier 2): webhooks del tenant por evento.
  await app.register(developerRoutes, { prefix: "/developer" });
  // Ingesta por API key (Tier 2): creación de pedidos desde sistemas externos.
  await app.register(ingestRoutes, { prefix: "/ingest" });
  // Propiedades personalizadas de parada (Tier 2 §9): campos extra por pedido,
  // con visibilidad por conductor/destinatario. Núcleo B2B, tope por plan.
  await app.register(customPropertiesRoutes, { prefix: "/custom-properties" });
  // Medición de uso + upsell (Tier 3 §12): uso del mes vs límites del plan.
  await app.register(usageRoutes, { prefix: "/usage" });
  // Onboarding guiado (Tier 3 §14): checklist de primeros pasos del tenant.
  await app.register(onboardingRoutes, { prefix: "/onboarding" });

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
  // Vistas guardadas del panel (filtros con nombre, privadas por usuario).
  await app.register(savedViewsRoutes, { prefix: "/saved-views" });
  // Copiloto IA (módulo AI_ADDONS): narra y propone sobre sistemas existentes.
  await app.register(copilotRoutes, { prefix: "/copilot" });
  // Capa de optimización con IA (módulo AI_ADDONS): registro de acciones,
  // botones "Optimizar con IA" y ruta de aplicación auditada (run → apply).
  await app.register(aiRoutes, { prefix: "/ai" });

  // Plano del operador de plataforma (autenticación separada).
  await app.register(platformRoutes, { prefix: "/platform" });

  return app;
}
