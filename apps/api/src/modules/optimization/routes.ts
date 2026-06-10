import type { FastifyInstance } from "fastify";
import { planRoutesSchema } from "@moveos/shared";
import { planRoutes as solveVrp } from "@moveos/optimizer";
import type { OptimizableOrder, OptimizableVehicle } from "@moveos/optimizer";
import { prisma } from "../../lib/prisma.js";
import { requireModule } from "../../plugins/entitlements.js";
import { requireRole } from "../../plugins/auth.js";
import { logOrderEvents } from "../../services/orderEvents.js";

/** Convierte un DateTime a minutos desde medianoche (UTC). */
function toMinOfDay(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

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

      const [tenant, dbOrders, dbVehicles] = await Promise.all([
        prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
        prisma.order.findMany({
          where: {
            id: { in: input.orderIds },
            tenantId,
            status: { in: ["PENDING", "GEOCODED"] },
            stops: { none: {} }, // aún no asignado a ninguna ruta
          },
        }),
        prisma.vehicle.findMany({
          where: { id: { in: input.vehicleIds }, tenantId },
        }),
      ]);

      if (dbOrders.length === 0) {
        return reply.code(400).send({ error: "No hay pedidos planificables (verifique estado y asignación previa)" });
      }
      if (dbVehicles.length === 0) {
        return reply.code(400).send({ error: "No hay vehículos válidos" });
      }

      const skipped = input.orderIds.filter(
        (id) => !dbOrders.some((o) => o.id === id),
      );

      const orders: OptimizableOrder[] = dbOrders
        .filter((o) => o.lat !== null && o.lng !== null)
        .map((o) => ({
          id: o.id,
          location: { lat: o.lat!, lng: o.lng! },
          pickupLocation:
            o.pickupLat !== null && o.pickupLng !== null
              ? { lat: o.pickupLat, lng: o.pickupLng }
              : undefined,
          weightKg: o.weightKg,
          volumeM3: o.volumeM3 ?? undefined,
          priority: o.priority,
          timeWindow:
            o.timeWindowStart && o.timeWindowEnd
              ? {
                  startMin: toMinOfDay(o.timeWindowStart),
                  endMin: toMinOfDay(o.timeWindowEnd),
                }
              : undefined,
        }));

      const vehicles: OptimizableVehicle[] = dbVehicles.map((v) => ({
        id: v.id,
        plate: v.plate,
        type: v.type as OptimizableVehicle["type"],
        capacityKg: v.capacityKg,
        capacityM3: v.capacityM3 ?? undefined,
        isElectric: v.isElectric,
        nominalRangeKm: v.nominalRangeKm ?? undefined,
        socPercent: input.socByVehicleId?.[v.id] ?? v.socPercent ?? undefined,
      }));

      const [yy, mm, dd] = input.date.split("-").map(Number);
      const planDate = new Date(yy!, mm! - 1, dd!);

      const result = solveVrp({
        date: planDate,
        city: tenant.city,
        depot: input.depot,
        orders,
        vehicles,
      });

      // Persistir rutas y marcar pedidos asignados.
      const created = [];
      for (const route of result.routes) {
        const dbRoute = await prisma.route.create({
          data: {
            tenantId,
            date: input.date,
            vehicleId: route.vehicleId,
            depotLat: input.depot.lat,
            depotLng: input.depot.lng,
            departureMin: 8 * 60,
            totalDistanceKm: route.totalDistanceKm,
            totalDurationMin: route.totalDurationMin,
            warnings: route.warnings,
            stops: {
              create: route.stops.map((s) => ({
                orderId: s.orderId,
                kind: s.kind,
                sequence: s.sequence,
                etaMin: s.etaMin,
              })),
            },
          },
          include: { stops: { orderBy: { sequence: "asc" } } },
        });
        // IDs únicos de pedidos (un pedido con recogida aparece en 2 paradas).
        const orderIds = [...new Set(route.stops.map((s) => s.orderId))];
        await prisma.order.updateMany({
          where: { id: { in: orderIds } },
          data: { status: "ASSIGNED" },
        });
        const plate = dbVehicles.find((v) => v.id === route.vehicleId)?.plate;
        await logOrderEvents(
          orderIds.map((orderId) => ({
            orderId,
            type: "ASSIGNED" as const,
            details: `Ruta ${plate ?? route.vehicleId}`,
          })),
        );
        created.push(dbRoute);
      }

      return reply.code(201).send({
        routes: created,
        unassigned: result.unassigned,
        excludedVehicles: result.excludedVehicles,
        skippedOrderIds: skipped,
      });
    },
  );
}
