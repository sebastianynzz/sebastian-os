import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import type { UserRole } from "@moveos/shared";
import { config } from "../config.js";
import { getTenantStatus } from "./tenantStatus.js";
import { getUserTokenVersion } from "../services/userTokens.js";

export async function registerAuth(app: FastifyInstance) {
  await app.register(fastifyJwt, {
    secret: config.jwtSecret,
    sign: { expiresIn: "12h" }, // jornada operativa; sin tokens eternos
    // Fija el algoritmo a HS256 (secreto simétrico): rechaza alg:none y la
    // confusión de algoritmo RS256→HS256. Defensa en profundidad.
    verify: { algorithms: ["HS256"] },
  });

  /**
   * Verificación base de un token de TENANT. Crítico para la seguridad
   * multi-tenant: un token de plataforma NO debe llegar a una ruta de tenant,
   * porque no trae `tenantId` y Prisma descarta silenciosamente un filtro
   * `undefined` → fuga de datos entre tenants. Por eso se rechaza
   * explícitamente cualquier token de plataforma o sin `tenantId`. Además
   * bloquea tenants suspendidos. Devuelve los claims, o null si ya respondió.
   */
  async function verifyTenantToken(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ role?: string; clientId?: string } | null> {
    try {
      await request.jwtVerify();
    } catch {
      await reply.code(401).send({ error: "No autenticado" });
      return null;
    }
    const claims = request.user as {
      typ?: string;
      sub?: string;
      tenantId?: string;
      role?: string;
      clientId?: string;
      tv?: number;
    };
    // Solo tokens de ACCESS de tenant: un token de plataforma o de REFRESH
    // (el de la cookie httpOnly, que solo sirve en /auth/refresh) nunca debe
    // autenticar una ruta de datos.
    if (
      claims.typ === "platform" ||
      claims.typ === "refresh" ||
      !claims.tenantId
    ) {
      await reply.code(401).send({ error: "Token no válido para esta ruta" });
      return null;
    }
    // Revocación: si el token trae versión (`tv`), debe coincidir con la del
    // usuario. Tras logout / reset de contraseña / cambio de rol se incrementa,
    // invalidando los JWT viejos sin esperar a su expiración. Usuario borrado →
    // null → 401. Tokens legados sin `tv` se aceptan (expiran ≤12 h).
    if (claims.tv !== undefined && claims.sub) {
      const current = await getUserTokenVersion(claims.sub);
      if (current === null || current !== claims.tv) {
        await reply
          .code(401)
          .send({ error: "Sesión finalizada", code: "TOKEN_REVOKED" });
        return null;
      }
    }
    const status = await getTenantStatus(claims.tenantId);
    // `null` = el tenant ya no existe (borrado): un token emitido antes (≤12 h)
    // no debe seguir autenticando. Se bloquea igual que un tenant suspendido.
    if (status === null) {
      await reply.code(401).send({ error: "Token no válido para esta ruta" });
      return null;
    }
    if (status === "SUSPENDED") {
      await reply.code(403).send({
        error: "Cuenta suspendida. Contacte al administrador de la plataforma.",
        code: "TENANT_SUSPENDED",
      });
      return null;
    }
    return claims;
  }

  /**
   * Autenticación del PERSONAL del tenant (ADMIN/DISPATCHER/DRIVER). Los
   * usuarios del portal de clientes (rol CLIENT) quedan excluidos por defecto
   * de todo el plano operativo: cualquier módulo nuevo que use `authenticate`
   * nace cerrado para ellos (fail-safe).
   */
  app.decorate(
    "authenticate",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const claims = await verifyTenantToken(request, reply);
      if (!claims) return;
      if (claims.role === "CLIENT") {
        return reply.code(403).send({
          error: "Función disponible solo para el equipo del operador",
          code: "CLIENT_PORTAL_ONLY",
        });
      }
    },
  );

  /**
   * Cualquier usuario del tenant, incluido el portal de clientes. Solo para
   * endpoints de identidad (p. ej. /auth/me); las rutas de datos usan
   * `authenticate` (personal) o `authenticateClient` (portal).
   */
  app.decorate(
    "authenticateTenant",
    async (request: FastifyRequest, reply: FastifyReply) => {
      await verifyTenantToken(request, reply);
    },
  );

  /**
   * Autenticación del PORTAL DE CLIENTES: exige rol CLIENT con negocio
   * asociado. Todas las consultas del portal filtran por `clientId` además
   * del `tenantId`.
   */
  app.decorate(
    "authenticateClient",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const claims = await verifyTenantToken(request, reply);
      if (!claims) return;
      if (claims.role !== "CLIENT" || !claims.clientId) {
        return reply
          .code(403)
          .send({ error: "Requiere una cuenta del portal de clientes" });
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
