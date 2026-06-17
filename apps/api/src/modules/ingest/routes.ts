import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createOrderSchema, type ApiKeyScope } from "@moveos/shared";
import { createOrder } from "../../services/orders.js";
import { verifyApiKey, type ApiKeyAuth } from "../../services/apiKeys.js";

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

/** preHandler que exige una API key válida con el scope dado. */
function requireApiScope(scope: ApiKeyScope) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.headers.authorization;
    const raw = auth?.startsWith("Bearer ")
      ? auth.slice(7)
      : (request.headers["x-api-key"] as string | undefined);
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
    { preHandler: [requireApiScope("orders:write")] },
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
}
