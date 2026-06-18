import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { createDriverSchema, updateDriverSchema } from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../../plugins/auth.js";

/** Verifica que un depósito pertenezca al tenant (aislamiento multi-depot). */
async function depotInTenant(tenantId: string, depotId: string): Promise<boolean> {
  const depot = await prisma.depot.findFirst({
    where: { id: depotId, tenantId },
    select: { id: true },
  });
  return Boolean(depot);
}

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

      if (input.depotId && !(await depotInTenant(request.user.tenantId, input.depotId))) {
        return reply.code(400).send({ error: "Depósito no encontrado" });
      }

      const driver = await prisma.driver.create({
        data: {
          tenantId: request.user.tenantId,
          name: input.name,
          phone: input.phone,
          documentId: input.documentId,
          licenseExpiresAt: input.licenseExpiresAt
            ? new Date(input.licenseExpiresAt)
            : undefined,
          depotId: input.depotId ?? undefined,
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

      if (
        input.depotId != null &&
        !(await depotInTenant(request.user.tenantId, input.depotId))
      ) {
        return reply.code(400).send({ error: "Depósito no encontrado" });
      }

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
          // null desasigna; ausente no toca.
          ...(input.depotId !== undefined ? { depotId: input.depotId } : {}),
        },
        include: { user: { select: { email: true } } },
      });
    },
  );
}
