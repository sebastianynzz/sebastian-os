import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { loginSchema } from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";

/** Autenticación del operador de plataforma (plano separado de los tenants). */
export default async function platformAuthRoutes(app: FastifyInstance) {
  app.post(
    "/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = loginSchema.parse(request.body);
      const admin = await prisma.platformAdmin.findUnique({
        where: { email: input.email },
      });
      if (!admin || !(await bcrypt.compare(input.password, admin.passwordHash))) {
        return reply.code(401).send({ error: "Credenciales inválidas" });
      }
      const token = app.jwt.sign({
        typ: "platform",
        sub: admin.id,
        email: admin.email,
        name: admin.name,
        platformAdmin: true,
      });
      return { token, admin: { id: admin.id, email: admin.email, name: admin.name } };
    },
  );

  app.get(
    "/me",
    { preHandler: [app.requirePlatformAdmin] },
    async (request) => {
      const admin = request.platformAdmin!;
      return { admin: { id: admin.sub, email: admin.email, name: admin.name } };
    },
  );
}
