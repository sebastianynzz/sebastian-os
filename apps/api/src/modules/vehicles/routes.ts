import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createVehicleSchema } from "@moveos/shared";
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

export default async function vehiclesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request) => {
    return prisma.vehicle.findMany({
      where: { tenantId: request.user.tenantId },
      orderBy: { createdAt: "asc" },
    });
  });

  app.post(
    "/",
    { preHandler: [requireRole("ADMIN", "DISPATCHER")] },
    async (request, reply) => {
      const input = createVehicleSchema.parse(request.body);
      if (
        input.homeDepotId &&
        !(await depotInTenant(request.user.tenantId, input.homeDepotId))
      ) {
        return reply.code(400).send({ error: "Depósito no encontrado" });
      }
      const vehicle = await prisma.vehicle.create({
        data: {
          tenantId: request.user.tenantId,
          plate: input.plate.toUpperCase().replace(/\s/g, ""),
          type: input.type,
          capacityKg: input.capacityKg,
          capacityM3: input.capacityM3,
          isElectric: input.isElectric,
          batteryKwh: input.batteryKwh,
          nominalRangeKm: input.nominalRangeKm,
          status: input.status ?? undefined,
          soatExpiresAt: input.soatExpiresAt ? new Date(input.soatExpiresAt) : undefined,
          tecnoExpiresAt: input.tecnoExpiresAt ? new Date(input.tecnoExpiresAt) : undefined,
          homeDepotId: input.homeDepotId ?? undefined,
        },
      });
      return reply.code(201).send(vehicle);
    },
  );

  /** Vencimientos documentales (SOAT / técnico-mecánica) próximos. */
  app.get("/compliance", async (request) => {
    const inThirtyDays = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const vehicles = await prisma.vehicle.findMany({
      where: { tenantId: request.user.tenantId },
    });
    return vehicles.map((v) => ({
      id: v.id,
      plate: v.plate,
      soatExpiresAt: v.soatExpiresAt,
      tecnoExpiresAt: v.tecnoExpiresAt,
      soatAlert: v.soatExpiresAt !== null && v.soatExpiresAt < inThirtyDays,
      tecnoAlert: v.tecnoExpiresAt !== null && v.tecnoExpiresAt < inThirtyDays,
    }));
  });

  app.patch(
    "/:id",
    { preHandler: [requireRole("ADMIN", "DISPATCHER")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = createVehicleSchema.partial().parse(request.body);
      const existing = await prisma.vehicle.findFirst({
        where: { id, tenantId: request.user.tenantId },
      });
      if (!existing) return reply.code(404).send({ error: "Vehículo no encontrado" });
      if (
        body.homeDepotId != null &&
        !(await depotInTenant(request.user.tenantId, body.homeDepotId))
      ) {
        return reply.code(400).send({ error: "Depósito no encontrado" });
      }
      return prisma.vehicle.update({
        where: { id },
        data: {
          ...body,
          plate: body.plate ? body.plate.toUpperCase().replace(/\s/g, "") : undefined,
          soatExpiresAt: body.soatExpiresAt ? new Date(body.soatExpiresAt) : undefined,
          tecnoExpiresAt: body.tecnoExpiresAt ? new Date(body.tecnoExpiresAt) : undefined,
        },
      });
    },
  );
}
