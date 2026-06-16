import type { FastifyInstance } from "fastify";
import { planRoutesSchema } from "@moveos/shared";
import { requireModule } from "../../plugins/entitlements.js";
import { requireRole } from "../../plugins/auth.js";
import { persistPlan, runPlan } from "../../services/planning.js";
import { computeInsertion, persistInsertion } from "../../services/insertion.js";

export default async function optimizationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.addHook("preHandler", requireModule("ROUTE_OPTIMIZATION"));

  /**
   * Genera un plan de rutas para un conjunto de pedidos y vehículos.
   * Aplica pico y placa, capacidad, ventanas horarias y autonomía EV.
   */
  app.post(
    "/plans",
    { preHandler: [requireRole("ADMIN", "DISPATCHER")] },
    async (request, reply) => {
      const input = planRoutesSchema.parse(request.body);
      const tenantId = request.user.tenantId;

      const outcome = await runPlan(tenantId, input);
      if (!outcome.ok) {
        return reply.code(400).send({ error: outcome.error });
      }

      const created = await persistPlan(
        tenantId,
        { date: input.date, depot: input.depot },
        outcome.result,
        outcome.dbVehicles,
      );

      return reply.code(201).send({
        routes: created,
        unassigned: outcome.result.unassigned,
        excludedVehicles: outcome.result.excludedVehicles,
        skippedOrderIds: outcome.skippedOrderIds,
        distanceModel: outcome.distanceModel,
      });
    },
  );

  /**
   * Inserción dinámica (express / mismo día): añade un pedido GEOCODED a una
   * ruta existente (PLANNED, DISPATCHED o IN_PROGRESS) en la mejor posición
   * factible de la cola pendiente. Las paradas ya atendidas no se tocan.
   */
  app.post(
    "/routes/:routeId/insert",
    { preHandler: [requireRole("ADMIN", "DISPATCHER")] },
    async (request, reply) => {
      const { routeId } = (request.params ?? {}) as { routeId: string };
      const { orderId } = (request.body ?? {}) as { orderId?: string };
      if (!orderId) return reply.code(400).send({ error: "Falta orderId" });
      const tenantId = request.user.tenantId;

      const computed = await computeInsertion(tenantId, routeId, orderId);
      if (!computed.ok) {
        return reply
          .code(computed.statusCode)
          .send({ error: computed.error, code: computed.code });
      }

      const updated = await persistInsertion(
        tenantId,
        computed.route,
        computed.newOrder,
        computed.attendedCount,
        computed.result,
      );
      return reply.code(201).send({
        route: updated,
        insertedAt: computed.result.insertedAt,
        distanceModel: computed.distanceModel,
      });
    },
  );
}
