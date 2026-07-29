import "@fastify/jwt";
import type { UserRole } from "@moveos/shared";

interface TenantClaims {
  typ?: "tenant";
  sub: string;
  tenantId: string;
  role: UserRole;
  driverId?: string;
  /** Portal de clientes: negocio cliente al que pertenece el usuario CLIENT. */
  clientId?: string;
  name: string;
  /** Versión de token para revocación (logout / reset / cambio de rol). */
  tv?: number;
  /** Consola de soporte: email del operador de plataforma que impersona. */
  impersonatedBy?: string;
}

interface PlatformClaims {
  typ: "platform";
  sub: string;
  email: string;
  name: string;
  platformAdmin: true;
}

/** Refresh token de tenant (cookie httpOnly): solo renueva el access token. */
interface RefreshClaims {
  typ: "refresh";
  sub: string;
  tenantId: string;
  tv?: number;
}

/** Refresh token del operador de plataforma (cookie httpOnly). */
interface PlatformRefreshClaims {
  typ: "platform-refresh";
  sub: string;
  email: string;
  name: string;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    // Lado de firma: access (tenant/platform) + refresh (tenant/platform).
    payload:
      | TenantClaims
      | PlatformClaims
      | RefreshClaims
      | PlatformRefreshClaims;
    // Lado de verificación: los handlers de tenant siempre leen forma de
    // tenant (el hook `authenticate` garantiza que un token de plataforma
    // nunca llega a una ruta de tenant). Los handlers de plataforma leen
    // `request.platformAdmin`, nunca `request.user`.
    user: TenantClaims;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (
      request: import("fastify").FastifyRequest,
      reply: import("fastify").FastifyReply,
    ) => Promise<void>;
    authenticateTenant: (
      request: import("fastify").FastifyRequest,
      reply: import("fastify").FastifyReply,
    ) => Promise<void>;
    authenticateClient: (
      request: import("fastify").FastifyRequest,
      reply: import("fastify").FastifyReply,
    ) => Promise<void>;
    requirePlatformAdmin: (
      request: import("fastify").FastifyRequest,
      reply: import("fastify").FastifyReply,
    ) => Promise<void>;
  }
  interface FastifyRequest {
    platformAdmin?: PlatformClaims;
  }
}
