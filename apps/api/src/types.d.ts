import "@fastify/jwt";
import type { UserRole } from "@moveos/shared";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: string;
      tenantId: string;
      role: UserRole;
      driverId?: string;
      name: string;
    };
    user: {
      sub: string;
      tenantId: string;
      role: UserRole;
      driverId?: string;
      name: string;
    };
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (
      request: import("fastify").FastifyRequest,
      reply: import("fastify").FastifyReply,
    ) => Promise<void>;
  }
}
