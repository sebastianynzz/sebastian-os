import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { isPushConfigured } from "../../services/push.js";

/**
 * Salud de integraciones (roadmap A2): un solo lugar para ver qué está
 * degradado — base de datos, OSRM, LLM del Copiloto, geocodificadores,
 * WhatsApp, email, almacenamiento y push.
 *
 * Pings reales solo donde son gratis (DB, OSRM, Anthropic models,
 * WhatsApp Graph, SendGrid scopes); los proveedores con costo por llamada
 * (Google/Lupap) reportan solo configuración. Resultado cacheado 60 s para
 * no convertir el panel en una fuente de carga.
 */

export type IntegrationStatus =
  | "OK" // configurado y el ping respondió
  | "DEGRADED" // configurado pero el ping falló
  | "CONFIGURED" // configurado; no se hace ping (costo por llamada)
  | "NOT_CONFIGURED";

export interface IntegrationHealth {
  key: string;
  label: string;
  status: IntegrationStatus;
  latencyMs: number | null;
  detail: string;
}

const PING_TIMEOUT_MS = 3500;
const CACHE_TTL_MS = 60_000;

let cache: { at: number; results: IntegrationHealth[] } | null = null;

async function timedPing(
  fn: (signal: AbortSignal) => Promise<boolean>,
): Promise<{ ok: boolean; latencyMs: number }> {
  const started = Date.now();
  try {
    const ok = await fn(AbortSignal.timeout(PING_TIMEOUT_MS));
    return { ok, latencyMs: Date.now() - started };
  } catch {
    return { ok: false, latencyMs: Date.now() - started };
  }
}

async function checkDatabase(): Promise<IntegrationHealth> {
  const { ok, latencyMs } = await timedPing(async () => {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  });
  return {
    key: "database",
    label: "Base de datos (Supabase Postgres)",
    status: ok ? "OK" : "DEGRADED",
    latencyMs,
    detail: ok ? "Consulta de prueba respondida" : "La consulta de prueba falló",
  };
}

async function checkOsrm(): Promise<IntegrationHealth> {
  const url = process.env.OSRM_URL;
  if (!url) {
    return {
      key: "osrm",
      label: "OSRM (matriz vial)",
      status: "NOT_CONFIGURED",
      latencyMs: null,
      detail: "Sin OSRM_URL: el optimizador usa distancias haversine",
    };
  }
  const { ok, latencyMs } = await timedPing(async (signal) => {
    const res = await fetch(
      `${url.replace(/\/$/, "")}/nearest/v1/driving/-74.0628,4.6486`,
      { signal },
    );
    return res.ok;
  });
  return {
    key: "osrm",
    label: "OSRM (matriz vial)",
    status: ok ? "OK" : "DEGRADED",
    latencyMs,
    detail: ok
      ? "Ruteo con red vial de Colombia activo"
      : "OSRM no responde: el optimizador cae a haversine",
  };
}

async function checkAnthropic(): Promise<IntegrationHealth> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      key: "anthropic",
      label: "Copiloto IA (Anthropic)",
      status: "NOT_CONFIGURED",
      latencyMs: null,
      detail: "Sin ANTHROPIC_API_KEY: el Copiloto responde 503",
    };
  }
  const { ok, latencyMs } = await timedPing(async (signal) => {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal,
    });
    return res.ok;
  });
  return {
    key: "anthropic",
    label: "Copiloto IA (Anthropic)",
    status: ok ? "OK" : "DEGRADED",
    latencyMs,
    detail: ok ? "API de Claude accesible" : "La API de Claude no respondió (¿clave/red?)",
  };
}

async function checkWhatsApp(): Promise<IntegrationHealth> {
  const token = process.env.WHATSAPP_BUSINESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) {
    return {
      key: "whatsapp",
      label: "WhatsApp Business",
      status: "NOT_CONFIGURED",
      latencyMs: null,
      detail: "Sin credenciales BSP: las notificaciones caen a consola",
    };
  }
  const { ok, latencyMs } = await timedPing(async (signal) => {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    return res.ok;
  });
  return {
    key: "whatsapp",
    label: "WhatsApp Business",
    status: ok ? "OK" : "DEGRADED",
    latencyMs,
    detail: ok ? "Número verificado accesible" : "Graph API rechazó las credenciales",
  };
}

async function checkSendgrid(): Promise<IntegrationHealth> {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) {
    return {
      key: "sendgrid",
      label: "Email B2B (SendGrid)",
      status: "NOT_CONFIGURED",
      latencyMs: null,
      detail: "Sin SENDGRID_API_KEY: el canal EMAIL cae a consola",
    };
  }
  const { ok, latencyMs } = await timedPing(async (signal) => {
    const res = await fetch("https://api.sendgrid.com/v3/scopes", {
      headers: { Authorization: `Bearer ${key}` },
      signal,
    });
    return res.ok;
  });
  return {
    key: "sendgrid",
    label: "Email B2B (SendGrid)",
    status: ok ? "OK" : "DEGRADED",
    latencyMs,
    detail: ok ? "Clave válida" : "SendGrid rechazó la clave",
  };
}

function configuredOnly(
  key: string,
  label: string,
  isConfigured: boolean,
  configuredDetail: string,
  missingDetail: string,
): IntegrationHealth {
  return {
    key,
    label,
    status: isConfigured ? "CONFIGURED" : "NOT_CONFIGURED",
    latencyMs: null,
    detail: isConfigured ? configuredDetail : missingDetail,
  };
}

async function computeHealth(): Promise<IntegrationHealth[]> {
  const [database, osrm, anthropic, whatsapp, sendgrid] = await Promise.all([
    checkDatabase(),
    checkOsrm(),
    checkAnthropic(),
    checkWhatsApp(),
    checkSendgrid(),
  ]);
  return [
    database,
    osrm,
    anthropic,
    whatsapp,
    sendgrid,
    configuredOnly(
      "google_maps",
      "Geocodificación Google",
      Boolean(process.env.GOOGLE_MAPS_API_KEY),
      "En la cascada (no se hace ping: costo por llamada)",
      "Sin clave: la cascada salta a mock tras el grafo/Lupap",
    ),
    configuredOnly(
      "lupap",
      "Geocodificación Lupap",
      Boolean(process.env.LUPAP_API_KEY),
      "En la cascada (no se hace ping: costo por llamada)",
      "Sin clave: pendiente de cotización Lupap",
    ),
    configuredOnly(
      "supabase_storage",
      "Evidencias POD (Supabase Storage)",
      Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
      "Bucket de evidencias configurado",
      "Sin credenciales: las fotos quedan en disco local",
    ),
    configuredOnly(
      "web_push",
      "Web Push (VAPID)",
      isPushConfigured(),
      "Avisos a conductor/despacho activos",
      "Sin claves VAPID: sin avisos push",
    ),
  ];
}

export default async function platformHealthRoutes(app: FastifyInstance) {
  app.get("/health", async (request) => {
    const query = z
      .object({ refresh: z.coerce.boolean().optional() })
      .parse(request.query);
    if (!query.refresh && cache && Date.now() - cache.at < CACHE_TTL_MS) {
      return { cachedAt: new Date(cache.at).toISOString(), results: cache.results };
    }
    const results = await computeHealth();
    cache = { at: Date.now(), results };
    return { cachedAt: new Date(cache.at).toISOString(), results };
  });
}
