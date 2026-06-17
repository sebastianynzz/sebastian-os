import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { createDriverSchema, updateDriverSchema } from "@moveos/shared";
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
          licenseExpiresAt: input.licenseExpiresAt
            ? new Date(input.licenseExpiresAt)
            : undefined,
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

  /**
   * Actualiza la disponibilidad (ACTIVE/INACTIVE) y/o el vencimiento de licencia
   * de un conductor. Acotado al tenant (nunca se confía el id del cliente).
   */
  app.patch(
    "/:id",
    { preHandler: [requireRole("ADMIN", "DISPATCHER")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const input = updateDriverSchema.parse(request.body);

      const driver = await prisma.driver.findFirst({
        where: { id, tenantId: request.user.tenantId },
      });
      if (!driver) return reply.code(404).send({ error: "Conductor no encontrado" });

      return prisma.driver.update({
        where: { id: driver.id },
        data: {
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.licenseExpiresAt !== undefined
            ? {
                licenseExpiresAt: input.licenseExpiresAt
                  ? new Date(input.licenseExpiresAt)
                  : null,
              }
            : {}),
        },
        include: { user: { select: { email: true } } },
      });
    },
  );
}
