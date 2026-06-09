import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import type { UserRole } from "@moveos/shared";
import { config } from "../config.js";

export async function registerAuth(app: FastifyInstance) {
  await app.register(fastifyJwt, { secret: config.jwtSecret });

  app.decorate(
    "authenticate",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch {
        return reply.code(401).send({ error: "No autenticado" });
      }
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
