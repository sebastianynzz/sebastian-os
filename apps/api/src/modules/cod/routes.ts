import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireModule } from "../../plugins/entitlements.js";
import { requireRole } from "../../plugins/auth.js";

/**
 * Módulo COD (contra-entrega): conciliación de recaudos y liquidación.
 * El recaudo se registra al completar la parada (módulo de rutas); aquí vive
 * la vista financiera: cuánto debe cada conductor, liquidaciones y descuadres.
 */
export default async function codRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.addHook("preHandler", requireModule("COD"));

  app.get("/payments", async (request) => {
    const query = z
      .object({ status: z.string().optional(), driverId: z.string().optional() })
      .parse(request.query);
    return prisma.codPayment.findMany({
      where: {
        tenantId: request.user.tenantId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.driverId ? { driverId: query.driverId } : {}),
      },
      include: {
        order: { select: { customerName: true, addressRaw: true, externalRef: true } },
        driver: { select: { name: true } },
      },
      orderBy: { collectedAt: "desc" },
    });
  });

  /** Resumen por conductor: efectivo en calle pendiente de liquidar. */
  app.get("/summary", async (request) => {
    const pending = await prisma.codPayment.groupBy({
      by: ["driverId"],
      where: { tenantId: request.user.tenantId, status: "COLLECTED" },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const drivers = await prisma.driver.findMany({
      where: { tenantId: request.user.tenantId },
      select: { id: true, name: true },
    });
    const nameById = new Map(drivers.map((d) => [d.id, d.name]));

    const totals = await prisma.codPayment.groupBy({
      by: ["status"],
      where: { tenantId: request.user.tenantId },
      _sum: { amount: true },
      _count: { _all: true },
    });

    return {
      pendingByDriver: pending.map((p) => ({
        driverId: p.driverId,
        driverName: p.driverId ? (nameById.get(p.driverId) ?? "—") : "Sin conductor",
        amount: p._sum.amount ?? 0,
        count: p._count._all,
      })),
      totalsByStatus: totals.map((t) => ({
        status: t.status,
        amount: t._sum.amount ?? 0,
        count: t._count._all,
      })),
    };
  });

  /**
   * Liquidación: el conductor entrega el efectivo recaudado. Si el monto
   * recibido difiere del esperado se marca DISCREPANCY para auditoría.
   */
  app.post(
    "/settlements",
    { preHandler: [requireRole("ADMIN", "DISPATCHER")] },
    async (request, reply) => {
      const body = z
        .object({
          driverId: z.string(),
          receivedAmount: z.number().int().nonnegative(),
          notes: z.string().optional(),
        })
        .parse(request.body);

      const payments = await prisma.codPayment.findMany({
        where: {
          tenantId: request.user.tenantId,
          driverId: body.driverId,
          status: "COLLECTED",
        },
      });
      if (payments.length === 0) {
        return reply.code(400).send({ error: "El conductor no tiene recaudos pendientes" });
      }

      const expectedAmount = payments.reduce((sum, p) => sum + p.amount, 0);
      const status = expectedAmount === body.receivedAmount ? "SETTLED" : "DISCREPANCY";

      const settlement = await prisma.$transaction(async (tx) => {
        const s = await tx.codSettlement.create({
          data: {
            tenantId: request.user.tenantId,
            driverId: body.driverId,
            expectedAmount,
            receivedAmount: body.receivedAmount,
            status,
            notes: body.notes,
          },
        });
        await tx.codPayment.updateMany({
          where: { id: { in: payments.map((p) => p.id) } },
          data: { status: status === "SETTLED" ? "SETTLED" : "DISCREPANCY", settlementId: s.id },
        });
        return s;
      });

      return reply.code(201).send(settlement);
    },
  );

  app.get("/settlements", async (request) => {
    return prisma.codSettlement.findMany({
      where: { tenantId: request.user.tenantId },
      include: { driver: { select: { name: true } }, payments: true },
      orderBy: { createdAt: "desc" },
    });
  });

  /** Analítica de rechazos COD: insumo para predicción de rechazo (IA, fase 3). */
  app.get("/rejections", async (request) => {
    const rejected = await prisma.order.findMany({
      where: {
        tenantId: request.user.tenantId,
        paymentType: "COD",
        status: "REJECTED",
      },
      select: {
        id: true,
        customerName: true,
        customerPhone: true,
        addressRaw: true,
        codAmount: true,
        failureReason: true,
        createdAt: true,
      },
    });
    const totalCod = await prisma.order.count({
      where: { tenantId: request.user.tenantId, paymentType: "COD" },
    });
    return {
      rejected,
      rejectionRate: totalCod === 0 ? 0 : rejected.length / totalCod,
    };
  });
}
