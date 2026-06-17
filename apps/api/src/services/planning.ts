import type { LatLng, PlanRoutesInput } from "@moveos/shared";
import {
  planRoutes as solveVrp,
  resolveNominalRangeKm,
} from "@moveos/optimizer";
import type {
  OptimizableOrder,
  OptimizableVehicle,
  PlanResult,
} from "@moveos/optimizer";
import { prisma } from "../lib/prisma.js";
import { logOrderEvents } from "./orderEvents.js";
import { emitOrderUpdate } from "./realtime.js";
import { buildTravelModel, toMinOfDayBogota } from "./routing.js";

/**
 * Núcleo compartido de planificación de rutas: arma las entradas del optimizador
 * desde la base, resuelve (determinista, sin LLM) y persiste. Lo usan tanto el
 * endpoint manual `/optimization/plans` como la acción de IA `optimize_routes`,
 * para que exista UNA sola ruta de cálculo y de aplicación.
 */

const toMinOfDay = toMinOfDayBogota;

export type PlanVehicleRef = { id: string; plate: string };

export type RunPlanOutcome =
  | { ok: false; error: string }
  | {
      ok: true;
      result: PlanResult;
      dbVehicles: PlanVehicleRef[];
      skippedOrderIds: string[];
      distanceModel: string;
      planDate: Date;
      depot: LatLng;
      date: string;
    };

/**
 * Resuelve un plan (sin persistir). Filtra pedidos planificables (geocodificados
 * y sin asignar) y vehículos del tenant; aplica autonomía por pack y cadena de
 * frío vía el optimizador. Es la fuente de la "ejecución en seco" (dry-run).
 */
export async function runPlan(
  tenantId: string,
  input: PlanRoutesInput,
): Promise<RunPlanOutcome> {
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
    return {
      ok: false,
      error:
        "No hay pedidos planificables (verifique estado y asignación previa)",
    };
  }
  if (dbVehicles.length === 0) {
    return { ok: false, error: "No hay vehículos válidos" };
  }

  const skippedOrderIds = input.orderIds.filter(
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
      tempProfile: o.tempProfile as OptimizableOrder["tempProfile"],
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
    nominalRangeKm: resolveNominalRangeKm({
      type: v.type as OptimizableVehicle["type"],
      batteryKwh: v.batteryKwh,
      nominalRangeKm: v.nominalRangeKm,
    }),
    socPercent: input.socByVehicleId?.[v.id] ?? v.socPercent ?? undefined,
  }));

  const [yy, mm, dd] = input.date.split("-").map(Number);
  const planDate = new Date(yy!, mm! - 1, dd!);

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
    objective: input.objective,
    travel,
  });

  return {
    ok: true,
    result,
    dbVehicles: dbVehicles.map((v) => ({ id: v.id, plate: v.plate })),
    skippedOrderIds,
    distanceModel,
    planDate,
    depot: input.depot,
    date: input.date,
  };
}

/**
 * Persiste un plan resuelto: crea rutas + paradas, marca pedidos ASSIGNED,
 * registra eventos en la bitácora y emite por tiempo real. Idéntico para el
 * endpoint manual y para la aplicación de la acción de IA.
 */
export async function persistPlan(
  tenantId: string,
  args: { date: string; depot: LatLng },
  result: PlanResult,
  dbVehicles: PlanVehicleRef[],
) {
  const created = [];
  for (const route of result.routes) {
    const dbRoute = await prisma.route.create({
      data: {
        tenantId,
        date: args.date,
        vehicleId: route.vehicleId,
        depotLat: args.depot.lat,
        depotLng: args.depot.lng,
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
    const assigned = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, clientId: true, status: true, trackingNumber: true },
    });
    for (const order of assigned) emitOrderUpdate(tenantId, order);
    created.push(dbRoute);
  }
  return created;
}
