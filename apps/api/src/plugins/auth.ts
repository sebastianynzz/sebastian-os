import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import type { UserRole } from "@moveos/shared";
import { config } from "../config.js";
import { getTenantStatus } from "./tenantStatus.js";

export async function registerAuth(app: FastifyInstance) {
  await app.register(fastifyJwt, {
    secret: config.jwtSecret,
    sign: { expiresIn: "12h" }, // jornada operativa; sin tokens eternos
  });

  /**
   * Autenticación de TENANT. Crítico para la seguridad multi-tenant: un token
   * de plataforma NO debe llegar a una ruta de tenant, porque no trae
   * `tenantId` y Prisma descarta silenciosamente un filtro `undefined` →
   * fuga de datos entre tenants. Por eso se rechaza explícitamente cualquier
   * token de plataforma o sin `tenantId`. Además bloquea tenants suspendidos.
   */
  app.decorate(
    "authenticate",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch {
        return reply.code(401).send({ error: "No autenticado" });
      }
      const claims = request.user as { typ?: string; tenantId?: string };
      if (claims.typ === "platform" || !claims.tenantId) {
        return reply.code(401).send({ error: "Token no válido para esta ruta" });
      }
      const status = await getTenantStatus(claims.tenantId);
      if (status === "SUSPENDED") {
        return reply.code(403).send({
          error: "Cuenta suspendida. Contacte al administrador de la plataforma.",
          code: "TENANT_SUSPENDED",
        });
      }
    },
  );

  /**
   * Autenticación de OPERADOR DE PLATAFORMA. Rechaza tokens de tenant (403) y
   * tokens ausentes/ inválidos (401). Decora `request.platformAdmin` para que
   * los handlers de plataforma nunca toquen `request.user`.
   */
  app.decorate(
    "requirePlatformAdmin",
    async (request: FastifyRequest, reply: FastifyReply) => {
      let claims: { typ?: string; sub: string; email: string; name: string; platformAdmin?: true };
      try {
        claims = await request.jwtVerify();
      } catch {
        return reply.code(401).send({ error: "No autenticado" });
      }
      if (claims.typ !== "platform" || !claims.platformAdmin) {
        return reply.code(403).send({ error: "Requiere operador de plataforma" });
      }
      request.platformAdmin = {
        typ: "platform",
        sub: claims.sub,
        email: claims.email,
        name: claims.name,
        platformAdmin: true,
      };
    },
  );
}

/** preHandler que exige uno de los roles dados (además de autenticación). */
export function requireRole(...roles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!roles.includes(request.user.role)) {
      return reply
        .code(403)
        .send({ error: `Requiere rol: ${roles.join(" o ")}` });
    }
  };
}
