import type { FastifyInstance } from "fastify";
import { planRoutesSchema } from "@moveos/shared";
import type { LatLng } from "@moveos/shared";
import {
  estimateUsableRangeKm,
  insertOrderIntoRoute,
  planRoutes as solveVrp,
} from "@moveos/optimizer";
import type { OptimizableOrder, OptimizableVehicle } from "@moveos/optimizer";
import { prisma } from "../../lib/prisma.js";
import { requireModule } from "../../plugins/entitlements.js";
import { requireRole } from "../../plugins/auth.js";
import { logOrderEvents } from "../../services/orderEvents.js";
import { emitOrderUpdate } from "../../services/realtime.js";
import { buildTravelModel, toMinOfDayBogota } from "../../services/routing.js";

const toMinOfDay = toMinOfDayBogota;

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

      // Modelo de viaje: matriz OSRM (red vial real) si está configurado;
      // haversine como base/fallback. Puntos: depósito + entregas + recogidas.
      const points: LatLng[] = [input.depot];
      for (const o of orders) {
        points.push(o.location);
        if (o.pickupLocation) points.push(o.pickupLocation);
      }
      const { model: travel, source: distanceModel } = await buildTravelModel(points);

      const result = solveVrp({
        date: planDate,
        city: tenant.city,
        depot: input.depot,
        orders,
        vehicles,
        travel,
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
        // Tiempo real: el dashboard y el portal del cliente ven la asignación.
        const assigned = await prisma.order.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, clientId: true, status: true, trackingNumber: true },
        });
        for (const order of assigned) emitOrderUpdate(tenantId, order);
        created.push(dbRoute);
      }

      return reply.code(201).send({
        routes: created,
        unassigned: result.unassigned,
        excludedVehicles: result.excludedVehicles,
        skippedOrderIds: skipped,
        distanceModel,
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

      const [route, newOrder] = await Promise.all([
        prisma.route.findFirst({
          where: {
            id: routeId,
            tenantId,
            status: { in: ["PLANNED", "DISPATCHED", "IN_PROGRESS"] },
          },
          include: {
            vehicle: true,
            stops: { orderBy: { sequence: "asc" }, include: { order: true } },
          },
        }),
        prisma.order.findFirst({
          where: { id: orderId, tenantId, status: { in: ["PENDING", "GEOCODED"] }, stops: { none: {} } },
        }),
      ]);
      if (!route) return reply.code(404).send({ error: "Ruta no encontrada o ya finalizada" });
      if (!newOrder || newOrder.lat === null || newOrder.lng === null) {
        return reply.code(404).send({ error: "Pedido no insertable (estado o geocodificación)" });
      }

      // Paradas atendidas quedan fijas; la cola re-optimizable es lo PENDING.
      const attended = route.stops.filter((s) => s.status !== "PENDING");
      const pendingStops = route.stops.filter((s) => s.status === "PENDING");

      // Reconstruir la cola de pedidos pendientes en su orden actual.
      const seen = new Set<string>();
      const pendingOrders: OptimizableOrder[] = [];
      let pendingLoadKg = 0;
      for (const s of pendingStops) {
        if (seen.has(s.orderId)) continue;
        seen.add(s.orderId);
        const o = s.order;
        if (o.lat === null || o.lng === null) continue;
        // Si la recogida ya ocurrió, solo queda la entrega.
        const pickupPending = pendingStops.some(
          (x) => x.orderId === o.id && x.kind === "PICKUP",
        );
        pendingOrders.push({
          id: o.id,
          location: { lat: o.lat, lng: o.lng },
          pickupLocation:
            pickupPending && o.pickupLat !== null && o.pickupLng !== null
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
        });
        pendingLoadKg += o.weightKg;
      }

      // Punto y reloj de partida: la última parada atendida, o el depósito.
      const lastAttended = attended[attended.length - 1];
      const start: LatLng =
        lastAttended?.order.lat != null && lastAttended.order.lng != null
          ? lastAttended.kind === "PICKUP" &&
            lastAttended.order.pickupLat != null &&
            lastAttended.order.pickupLng != null
            ? { lat: lastAttended.order.pickupLat, lng: lastAttended.order.pickupLng }
            : { lat: lastAttended.order.lat, lng: lastAttended.order.lng }
          : { lat: route.depotLat, lng: route.depotLng };
      const lastDone = lastAttended?.completedAt ?? lastAttended?.arrivedAt;
      const departureMin = lastDone ? toMinOfDay(lastDone) : route.departureMin;

      // EV: presupuesto desde el SoC ACTUAL (telemetría) — cubre lo restante.
      const rangeBudgetKm =
        route.vehicle.isElectric && route.vehicle.nominalRangeKm
          ? estimateUsableRangeKm({
              nominalRangeKm: route.vehicle.nominalRangeKm,
              socPercent: route.vehicle.socPercent ?? 100,
            })
          : Number.POSITIVE_INFINITY;

      const points: LatLng[] = [start, { lat: route.depotLat, lng: route.depotLng }];
      for (const o of pendingOrders) {
        points.push(o.location);
        if (o.pickupLocation) points.push(o.pickupLocation);
      }
      points.push({ lat: newOrder.lat, lng: newOrder.lng });
      if (newOrder.pickupLat !== null && newOrder.pickupLng !== null) {
        points.push({ lat: newOrder.pickupLat, lng: newOrder.pickupLng });
      }
      const { model: travel, source: distanceModel } = await buildTravelModel(points);

      const result = insertOrderIntoRoute({
        pendingOrders,
        newOrder: {
          id: newOrder.id,
          location: { lat: newOrder.lat, lng: newOrder.lng },
          pickupLocation:
            newOrder.pickupLat !== null && newOrder.pickupLng !== null
              ? { lat: newOrder.pickupLat, lng: newOrder.pickupLng }
              : undefined,
          weightKg: newOrder.weightKg,
          volumeM3: newOrder.volumeM3 ?? undefined,
          priority: newOrder.priority,
          timeWindow:
            newOrder.timeWindowStart && newOrder.timeWindowEnd
              ? {
                  startMin: toMinOfDay(newOrder.timeWindowStart),
                  endMin: toMinOfDay(newOrder.timeWindowEnd),
                }
              : undefined,
        },
        vehicle: {
          id: route.vehicle.id,
          plate: route.vehicle.plate,
          type: route.vehicle.type as OptimizableVehicle["type"],
          capacityKg: route.vehicle.capacityKg,
          capacityM3: route.vehicle.capacityM3 ?? undefined,
          isElectric: route.vehicle.isElectric,
          nominalRangeKm: route.vehicle.nominalRangeKm ?? undefined,
          socPercent: route.vehicle.socPercent ?? undefined,
        },
        start,
        returnTo: { lat: route.depotLat, lng: route.depotLng },
        departureMin,
        rangeBudgetKm,
        currentLoadKg: pendingLoadKg,
        travel,
      });

      if (!result) {
        return reply.code(422).send({
          error:
            "El pedido no cabe en esta ruta (capacidad, ventanas horarias, autonomía o jornada)",
          code: "INSERTION_INFEASIBLE",
        });
      }

      // Persistir: reemplazar la cola pendiente con la nueva secuencia.
      const baseSeq = attended.length;
      await prisma.$transaction(async (tx) => {
        await tx.routeStop.deleteMany({
          where: { routeId: route.id, status: "PENDING" },
        });
        await tx.routeStop.createMany({
          data: result.stops.map((s, i) => ({
            routeId: route.id,
            orderId: s.orderId,
            kind: s.kind,
            sequence: baseSeq + i + 1,
            etaMin: s.etaMin,
          })),
        });
        await tx.order.update({
          where: { id: newOrder.id },
          data: { status: route.status === "PLANNED" ? "ASSIGNED" : "IN_TRANSIT" },
        });
        await tx.route.update({
          where: { id: route.id },
          data: {
            totalDistanceKm: result.totalDistanceKm,
            totalDurationMin: result.totalDurationMin,
          },
        });
      });

      await logOrderEvents([
        {
          orderId: newOrder.id,
          type: "ASSIGNED",
          details: `Inserción express en ruta ${route.vehicle.plate} (posición ${result.insertedAt + 1})`,
        },
      ]);
      emitOrderUpdate(tenantId, {
        ...newOrder,
        status: route.status === "PLANNED" ? "ASSIGNED" : "IN_TRANSIT",
      });

      const updated = await prisma.route.findUnique({
        where: { id: route.id },
        include: {
          vehicle: true,
          stops: { orderBy: { sequence: "asc" }, include: { order: true } },
        },
      });
      return reply.code(201).send({ route: updated, insertedAt: result.insertedAt, distanceModel });
    },
  );
}
