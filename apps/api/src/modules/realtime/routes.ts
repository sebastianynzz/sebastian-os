import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getTenantStatus } from "../../plugins/tenantStatus.js";
import {
  openSseStream,
  subscribePlatform,
  subscribeTenant,
} from "../../services/realtime.js";

/**
 * Streams SSE de tiempo real (sustituyen el sondeo de los frontends).
 *
 * EventSource del navegador no permite encabezados personalizados, por eso el
 * JWT llega por query string (`?token=`). El token vive 12 h y la conexión es
 * de un solo sentido (server → browser); el frontend mantiene un sondeo lento
 * de respaldo por si el stream se cae.
 */
export default async function realtimeRoutes(app: FastifyInstance) {
  /** Stream del tenant: telemetría, alertas de seguridad y pedidos. */
  app.get("/stream", async (request, reply) => {
    const { token } = z
      .object({ token: z.string().min(10) })
      .parse(request.query);

    let claims: {
      typ?: string;
      tenantId?: string;
      role?: string;
      clientId?: string;
    };
    try {
      claims = app.jwt.verify(token);
    } catch {
      return reply.code(401).send({ error: "No autenticado" });
    }
    if (claims.typ === "platform" || !claims.tenantId) {
      return reply.code(401).send({ error: "Token no válido para esta ruta" });
    }
    if ((await getTenantStatus(claims.tenantId)) === "SUSPENDED") {
      return reply.code(403).send({ error: "Cuenta suspendida" });
    }
    if (claims.role === "CLIENT" && !claims.clientId) {
      return reply.code(403).send({ error: "Cuenta del portal sin negocio asociado" });
    }

    const { sub, onClose } = openSseStream(request, reply);
    // Portal de clientes: el bus filtra y solo le entrega pedidos de SU negocio.
    if (claims.role === "CLIENT") sub.clientId = claims.clientId;
    onClose(subscribeTenant(claims.tenantId, sub));
  });

  /** Stream del operador de plataforma: flota FaaS a través de tenants. */
  app.get("/platform/stream", async (request, reply) => {
    const { token } = z
      .object({ token: z.string().min(10) })
      .parse(request.query);

    let claims: { typ?: string; platformAdmin?: true };
    try {
      claims = app.jwt.verify(token);
    } catch {
      return reply.code(401).send({ error: "No autenticado" });
    }
    if (claims.typ !== "platform" || !claims.platformAdmin) {
      return reply.code(403).send({ error: "Requiere operador de plataforma" });
    }

    const { sub, onClose } = openSseStream(request, reply);
    onClose(subscribePlatform(sub));
  });
}
