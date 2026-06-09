import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { createDriverSchema } from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../../plugins/auth.js";

export default async function driversRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request) => {
    return prisma.driver.findMany({
      where: { tenantId: request.user.tenantId },
      include: { user: { select: { email: true } } },
      orderBy: { createdAt: "asc" },
    });
  });

  app.post(
    "/",
    { preHandler: [requireRole("ADMIN", "DISPATCHER")] },
    async (request, reply) => {
      const input = createDriverSchema.parse(request.body);

      const driver = await prisma.driver.create({
        data: {
          tenantId: request.user.tenantId,
          name: input.name,
          phone: input.phone,
          documentId: input.documentId,
        },
      });

      // Cuenta de acceso a la app de conductor (opcional).
      if (input.email && input.password) {
        await prisma.user.create({
          data: {
            tenantId: request.user.tenantId,
            email: input.email,
            passwordHash: await bcrypt.hash(input.password, 10),
            name: input.name,
            role: "DRIVER",
            driverId: driver.id,
          },
        });
      }

      return reply.code(201).send(driver);
    },
  );
}
