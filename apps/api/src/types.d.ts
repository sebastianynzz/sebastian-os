import "@fastify/jwt";
import type { UserRole } from "@moveos/shared";

interface TenantClaims {
  typ?: "tenant";
  sub: string;
  tenantId: string;
  role: UserRole;
  driverId?: string;
  name: string;
}

interface PlatformClaims {
  typ: "platform";
  sub: string;
  email: string;
  name: string;
  platformAdmin: true;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    // Lado de firma: se aceptan ambos tipos de token.
    payload: TenantClaims | PlatformClaims;
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
    requirePlatformAdmin: (
      request: import("fastify").FastifyRequest,
      reply: import("fastify").FastifyReply,
    ) => Promise<void>;
  }
  interface FastifyRequest {
    platformAdmin?: PlatformClaims;
  }
}
