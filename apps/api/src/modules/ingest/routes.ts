import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createOrderSchema, type ApiKeyScope } from "@moveos/shared";
import { createOrder } from "../../services/orders.js";
import { verifyApiKey, type ApiKeyAuth } from "../../services/apiKeys.js";
import { CONNECTOR_SOURCES, normalizeOrder } from "../../services/connectors.js";

/**
 * Ingesta por API key (plataforma de desarrolladores, Tier 2 §8): endpoints que
 * un sistema externo (tienda, marketplace) llama con su API key para crear
 * pedidos — el desbloqueo de escala. NO usa JWT; se autentica con la key y sus
 * scopes. Tenant-scoped por la key.
 */

declare module "fastify" {
  interface FastifyRequest {
    apiAuth?: ApiKeyAuth;
  }
}

/** Extrae la API key cruda de la cabecera (Bearer o x-api-key). */
function rawApiKey(request: FastifyRequest): string | undefined {
  const auth = request.headers.authorization;
  return auth?.startsWith("Bearer ")
    ? auth.slice(7)
    : (request.headers["x-api-key"] as string | undefined);
}

/**
 * Límite por ruta para la ingesta de pedidos, acotado POR API KEY (no por IP):
 * una key filtrada o abusiva no puede inundar la creación de pedidos (escrituras
 * a BD + cascada de geocodificación + fan-out de webhooks) más allá de este
 * tope. Cae al IP si no hay key (esos casos los rechaza 401 igual).
 */
const ingestRateLimit = {
  max: 60,
  timeWindow: "1 minute",
  keyGenerator: (request: FastifyRequest) => rawApiKey(request) ?? request.ip,
};

/** preHandler que exige una API key válida con el scope dado. */
function requireApiScope(scope: ApiKeyScope) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const raw = rawApiKey(request);
    if (!raw) return reply.code(401).send({ error: "Falta API key" });
    const key = await verifyApiKey(raw);
    if (!key) return reply.code(401).send({ error: "API key inválida" });
    if (!key.scopes.includes(scope)) {
      return reply.code(403).send({ error: `La API key no tiene el permiso: ${scope}` });
    }
    request.apiAuth = key;
  };
}

export default async function ingestRoutes(app: FastifyInstance) {
  app.post(
    "/orders",
    {
      config: { rateLimit: ingestRateLimit },
      preHandler: [requireApiScope("orders:write")],
    },
    async (request, reply) => {
      const input = createOrderSchema.parse(request.body);
      const order = await createOrder(request.apiAuth!.tenantId, input);
      return reply.code(201).send({
        id: order.id,
        trackingNumber: order.trackingNumber,
        status: order.status,
      });
    },
  );

  /**
   * Ingesta por conector (Tier 2 §8): un sistema externo (Shopify, VTEX, Mercado
   * Libre, Zapier) envía SU formato de pedido y el conector lo normaliza al
   * formato de createOrder. Misma autenticación por API key + scope orders:write.
   * Order-ingestion es el desbloqueo de escala: pedidos entran desde donde vende
   * el cliente.
   */
  app.post(
    "/orders/:source",
    {
      config: { rateLimit: ingestRateLimit },
      preHandler: [requireApiScope("orders:write")],
    },
    async (request, reply) => {
      const { source } = z
        .object({ source: z.enum(CONNECTOR_SOURCES) })
        .parse(request.params);
      const normalized = normalizeOrder(source, request.body);
      const input = createOrderSchema.parse(normalized);
      const order = await createOrder(request.apiAuth!.tenantId, input);
      return reply.code(201).send({
        id: order.id,
        trackingNumber: order.trackingNumber,
        status: order.status,
        source,
      });
    },
  );
}
