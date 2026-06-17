import type { LatLng } from "@moveos/shared";
import {
  estimateUsableRangeKm,
  evaluateSequence,
  insertOrderIntoRoute,
  resolveNominalRangeKm,
} from "@moveos/optimizer";
import type {
  InsertResult,
  OptimizableOrder,
  OptimizableVehicle,
} from "@moveos/optimizer";
import type { Order, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { logOrderEvents } from "./orderEvents.js";
import { emitOrderUpdate } from "./realtime.js";
import { sendPushToDriver } from "./push.js";
import { buildTravelModel, toMinOfDayBogota } from "./routing.js";

/**
 * Inserción dinámica (express / mismo día) extraída a servicio: la usan el
 * endpoint manual `/optimization/routes/:routeId/insert` y la acción de IA
 * `reoptimize_route`. Congela las paradas atendidas y re-optimiza la cola
 * pendiente respetando capacidad, ventanas, cadena de frío y autonomía EV.
 */

const toMinOfDay = toMinOfDayBogota;

type RouteWithStops = Prisma.RouteGetPayload<{
  include: { vehicle: true; stops: { include: { order: true } } };
}>;

export type ComputeInsertionResult =
  | { ok: false; statusCode: number; error: string; code?: string }
  | {
      ok: true;
      route: RouteWithStops;
      newOrder: Order;
      attendedCount: number;
      result: InsertResult;
      distanceModel: string;
    };

/** Calcula la mejor inserción (sin persistir). */
export async function computeInsertion(
  tenantId: string,
  routeId: string,
  orderId: string,
): Promise<ComputeInsertionResult> {
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
  if (!route) {
    return { ok: false, statusCode: 404, error: "Ruta no encontrada o ya finalizada" };
  }
  if (!newOrder || newOrder.lat === null || newOrder.lng === null) {
    return {
      ok: false,
      statusCode: 404,
      error: "Pedido no insertable (estado o geocodificación)",
    };
  }

  const attended = route.stops.filter((s) => s.status !== "PENDING");
  const pendingStops = route.stops.filter((s) => s.status === "PENDING");

  const seen = new Set<string>();
  const pendingOrders: OptimizableOrder[] = [];
  let pendingLoadKg = 0;
  for (const s of pendingStops) {
    if (seen.has(s.orderId)) continue;
    seen.add(s.orderId);
    const o = s.order;
    if (o.lat === null || o.lng === null) continue;
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
      tempProfile: o.tempProfile as OptimizableOrder["tempProfile"],
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

  const rangeBudgetKm = route.vehicle.isElectric
    ? estimateUsableRangeKm({
        nominalRangeKm: resolveNominalRangeKm({
          type: route.vehicle.type as OptimizableVehicle["type"],
          batteryKwh: route.vehicle.batteryKwh,
          nominalRangeKm: route.vehicle.nominalRangeKm,
        }),
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
      tempProfile: newOrder.tempProfile as OptimizableOrder["tempProfile"],
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
    return {
      ok: false,
      statusCode: 422,
      error:
        "El pedido no cabe en esta ruta (capacidad, ventanas horarias, autonomía o jornada)",
      code: "INSERTION_INFEASIBLE",
    };
  }

  return {
    ok: true,
    route,
    newOrder,
    attendedCount: attended.length,
    result,
    distanceModel,
  };
}

/** Persiste una inserción ya calculada: reemplaza la cola pendiente y notifica. */
export async function persistInsertion(
  tenantId: string,
  route: RouteWithStops,
  newOrder: Order,
  attendedCount: number,
  result: InsertResult,
) {
  await prisma.$transaction(async (tx) => {
    await tx.routeStop.deleteMany({
      where: { routeId: route.id, status: "PENDING" },
    });
    await tx.routeStop.createMany({
      data: result.stops.map((s, i) => ({
        routeId: route.id,
        orderId: s.orderId,
        kind: s.kind,
        sequence: attendedCount + i + 1,
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

  if (route.driverId && route.status !== "PLANNED") {
    void sendPushToDriver(tenantId, route.driverId, {
      title: "Parada agregada a tu ruta",
      body: `${newOrder.customerName} — revisa la nueva secuencia`,
      url: "/",
    });
  }

  return prisma.route.findUnique({
    where: { id: route.id },
    include: {
      vehicle: true,
      stops: { orderBy: { sequence: "asc" }, include: { order: true } },
    },
  });
}

export type ResequenceResult =
  | { ok: false; statusCode: number; error: string; code?: string }
  | { ok: true; route: unknown; distanceModel: string };

/**
 * Ajuste manual del orden de visita ANTES de despachar: reordena los pedidos de
 * una ruta PLANNED según `orderIds` (el despachador fija la secuencia) y
 * recalcula ETAs/distancia/duración con el mismo modelo del planificador, sin
 * reoptimizar. Solo rutas PLANNED (sin paradas atendidas). 422 si la secuencia
 * es infactible (ventanas horarias, autonomía o jornada).
 */
export async function resequencePlannedRoute(
  tenantId: string,
  routeId: string,
  orderIds: string[],
): Promise<ResequenceResult> {
  const route = await prisma.route.findFirst({
    where: { id: routeId, tenantId, status: "PLANNED" },
    include: {
      vehicle: true,
      stops: { orderBy: { sequence: "asc" }, include: { order: true } },
    },
  });
  if (!route) {
    return { ok: false, statusCode: 404, error: "Ruta no encontrada o ya despachada" };
  }

  // La secuencia debe ser una permutación exacta de los pedidos de la ruta.
  const distinct = [...new Set(route.stops.map((s) => s.orderId))];
  const want = new Set(orderIds);
  if (
    orderIds.length !== distinct.length ||
    want.size !== orderIds.length ||
    !distinct.every((id) => want.has(id))
  ) {
    return {
      ok: false,
      statusCode: 400,
      error: "La secuencia debe contener exactamente los pedidos de la ruta, sin repetir",
      code: "BAD_SEQUENCE",
    };
  }

  const orderById = new Map(route.stops.map((s) => [s.orderId, s.order]));
  const ordered: OptimizableOrder[] = [];
  for (const id of orderIds) {
    const o = orderById.get(id)!;
    if (o.lat === null || o.lng === null) {
      return {
        ok: false,
        statusCode: 422,
        error: "La ruta tiene un pedido sin geocodificar",
        code: "SEQUENCE_INFEASIBLE",
      };
    }
    const hasPickup = route.stops.some((s) => s.orderId === id && s.kind === "PICKUP");
    ordered.push({
      id: o.id,
      location: { lat: o.lat, lng: o.lng },
      pickupLocation:
        hasPickup && o.pickupLat !== null && o.pickupLng !== null
          ? { lat: o.pickupLat, lng: o.pickupLng }
          : undefined,
      weightKg: o.weightKg,
      volumeM3: o.volumeM3 ?? undefined,
      tempProfile: o.tempProfile as OptimizableOrder["tempProfile"],
      priority: o.priority,
      timeWindow:
        o.timeWindowStart && o.timeWindowEnd
          ? {
              startMin: toMinOfDay(o.timeWindowStart),
              endMin: toMinOfDay(o.timeWindowEnd),
            }
          : undefined,
    });
  }

  const rangeBudgetKm = route.vehicle.isElectric
    ? estimateUsableRangeKm({
        nominalRangeKm: resolveNominalRangeKm({
          type: route.vehicle.type as OptimizableVehicle["type"],
          batteryKwh: route.vehicle.batteryKwh,
          nominalRangeKm: route.vehicle.nominalRangeKm,
        }),
        socPercent: route.vehicle.socPercent ?? 100,
      })
    : Number.POSITIVE_INFINITY;

  const depot: LatLng = { lat: route.depotLat, lng: route.depotLng };
  const points: LatLng[] = [depot];
  for (const o of ordered) {
    points.push(o.location);
    if (o.pickupLocation) points.push(o.pickupLocation);
  }
  const { model: travel, source: distanceModel } = await buildTravelModel(points);

  const result = evaluateSequence({
    orders: ordered,
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
    depot,
    departureMin: route.departureMin,
    rangeBudgetKm,
    travel,
  });
  if (!result) {
    return {
      ok: false,
      statusCode: 422,
      error:
        "Esa secuencia no es factible (ventanas horarias, autonomía o jornada). Ajústala o usa la optimización.",
      code: "SEQUENCE_INFEASIBLE",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.routeStop.deleteMany({ where: { routeId: route.id } });
    await tx.routeStop.createMany({
      data: result.stops.map((s, i) => ({
        routeId: route.id,
        orderId: s.orderId,
        kind: s.kind,
        sequence: i + 1,
        etaMin: s.etaMin,
      })),
    });
    await tx.route.update({
      where: { id: route.id },
      data: {
        totalDistanceKm: result.totalDistanceKm,
        totalDurationMin: result.totalDurationMin,
      },
    });
  });

  const updated = await prisma.route.findUnique({
    where: { id: route.id },
    include: { stops: { orderBy: { sequence: "asc" } } },
  });
  return { ok: true, route: updated, distanceModel };
}
