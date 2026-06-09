import { roadDistanceKm, type LatLng, type VehicleType } from "@moveos/shared";
import { checkPicoYPlaca } from "./picoYPlaca.js";
import { estimateUsableRangeKm } from "./evRange.js";
import type {
  OptimizableOrder,
  OptimizableVehicle,
  PlanRequest,
  PlanResult,
  PlannedRoute,
  PlannedStop,
} from "./types.js";

/**
 * Velocidades urbanas promedio por tipo de vehículo (km/h), calibradas para
 * tráfico denso tipo Bogotá. Las motos son significativamente más rápidas en
 * congestión: esto hace que el optimizador prefiera motos para rutas urbanas.
 */
const URBAN_SPEED_KMH: Record<VehicleType, number> = {
  MOTO: 22,
  BICICLETA: 13,
  CARRO: 17,
  VAN: 16,
  CAMION: 14,
};

const DEFAULT_SERVICE_TIME_MIN = 6;
const DEFAULT_DEPARTURE_MIN = 8 * 60;
/** Jornada máxima de una ruta (minutos). */
const MAX_ROUTE_DURATION_MIN = 10 * 60;

interface VehicleState {
  vehicle: OptimizableVehicle;
  stops: OptimizableOrder[];
  loadKg: number;
  loadM3: number;
  /** Presupuesto de distancia (km). Infinity para combustión. */
  rangeBudgetKm: number;
  warnings: string[];
}

function speedFor(v: OptimizableVehicle): number {
  return URBAN_SPEED_KMH[v.type];
}

function travelMin(a: LatLng, b: LatLng, v: OptimizableVehicle): number {
  return (roadDistanceKm(a, b) / speedFor(v)) * 60;
}

/**
 * Simula la ruta (depósito → paradas → depósito) y devuelve métricas, o null
 * si viola ventanas horarias, jornada máxima o autonomía.
 */
function simulateRoute(
  depot: LatLng,
  stops: OptimizableOrder[],
  vehicle: OptimizableVehicle,
  departureMin: number,
  rangeBudgetKm: number,
): {
  etas: number[];
  legDistances: number[];
  totalDistanceKm: number;
  totalDurationMin: number;
} | null {
  let clock = departureMin;
  let prev = depot;
  let totalKm = 0;
  const etas: number[] = [];
  const legDistances: number[] = [];

  for (const stop of stops) {
    const legKm = roadDistanceKm(prev, stop.location);
    totalKm += legKm;
    clock += (legKm / speedFor(vehicle)) * 60;

    if (stop.timeWindow) {
      if (clock > stop.timeWindow.endMin) return null;
      if (clock < stop.timeWindow.startMin) clock = stop.timeWindow.startMin;
    }
    etas.push(clock);
    legDistances.push(legKm);
    clock += stop.serviceTimeMin ?? DEFAULT_SERVICE_TIME_MIN;
    prev = stop.location;
  }

  // Regreso al depósito.
  const returnKm = roadDistanceKm(prev, depot);
  totalKm += returnKm;
  clock += (returnKm / speedFor(vehicle)) * 60;

  if (totalKm > rangeBudgetKm) return null;
  if (clock - departureMin > MAX_ROUTE_DURATION_MIN) return null;

  return {
    etas,
    legDistances,
    totalDistanceKm: totalKm,
    totalDurationMin: clock - departureMin,
  };
}

/**
 * Mejora 2-opt: invierte segmentos de la secuencia si reduce distancia total
 * sin violar la factibilidad (ventanas horarias, autonomía, jornada).
 */
function twoOptImprove(
  depot: LatLng,
  stops: OptimizableOrder[],
  vehicle: OptimizableVehicle,
  departureMin: number,
  rangeBudgetKm: number,
): OptimizableOrder[] {
  let best = stops.slice();
  let bestSim = simulateRoute(depot, best, vehicle, departureMin, rangeBudgetKm);
  if (!bestSim) return best;

  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = best
          .slice(0, i)
          .concat(best.slice(i, j + 1).reverse(), best.slice(j + 1));
        const sim = simulateRoute(
          depot,
          candidate,
          vehicle,
          departureMin,
          rangeBudgetKm,
        );
        if (sim && sim.totalDistanceKm < bestSim.totalDistanceKm - 1e-9) {
          best = candidate;
          bestSim = sim;
          improved = true;
        }
      }
    }
  }
  return best;
}

/**
 * Planificador VRP heurístico: filtra vehículos por pico y placa, calcula
 * presupuesto de autonomía para EVs, asigna pedidos por vecino más cercano
 * con chequeo de factibilidad completo y mejora cada ruta con 2-opt.
 */
export function planRoutes(request: PlanRequest): PlanResult {
  const departureMin = request.departureMin ?? DEFAULT_DEPARTURE_MIN;
  const excludedVehicles: PlanResult["excludedVehicles"] = [];
  const states: VehicleState[] = [];

  for (const vehicle of request.vehicles) {
    const check = checkPicoYPlaca(
      { plate: vehicle.plate, type: vehicle.type, isElectric: vehicle.isElectric },
      request.city,
      request.date,
      departureMin,
    );
    if (check.restricted) {
      excludedVehicles.push({
        vehicleId: vehicle.id,
        reason: check.reason ?? "Pico y placa",
      });
      continue;
    }

    let rangeBudgetKm = Number.POSITIVE_INFINITY;
    const warnings: string[] = [];
    if (vehicle.isElectric) {
      if (vehicle.nominalRangeKm) {
        rangeBudgetKm = estimateUsableRangeKm({
          nominalRangeKm: vehicle.nominalRangeKm,
          socPercent: vehicle.socPercent ?? 100,
          temperatureC: request.evConditions?.temperatureC,
          payloadKg: request.evConditions?.avgPayloadKg,
          elevationGainM: request.evConditions?.elevationGainM,
        });
        if ((vehicle.socPercent ?? 100) < 80) {
          warnings.push(
            `EV con SoC ${vehicle.socPercent}%: autonomía útil estimada ${rangeBudgetKm.toFixed(1)} km`,
          );
        }
      } else {
        warnings.push(
          "EV sin autonomía nominal configurada: se planifica sin límite de rango",
        );
      }
    }

    states.push({
      vehicle,
      stops: [],
      loadKg: 0,
      loadM3: 0,
      rangeBudgetKm,
      warnings,
    });
  }

  // Prioridad alta primero; a igual prioridad, mayor peso primero (bin packing).
  const pending = request.orders
    .slice()
    .sort((a, b) => b.priority - a.priority || b.weightKg - a.weightKg);

  const unassigned: PlanResult["unassigned"] = [];

  for (const order of pending) {
    let bestState: VehicleState | null = null;
    let bestCost = Number.POSITIVE_INFINITY;
    let lastRejection = "Sin vehículos disponibles";

    for (const state of states) {
      if (state.loadKg + order.weightKg > state.vehicle.capacityKg) {
        lastRejection = "Capacidad de peso excedida en todos los vehículos";
        continue;
      }
      if (
        state.vehicle.capacityM3 !== undefined &&
        state.loadM3 + (order.volumeM3 ?? 0) > state.vehicle.capacityM3
      ) {
        lastRejection = "Capacidad de volumen excedida en todos los vehículos";
        continue;
      }

      // Inserción al final (vecino más cercano sobre la última parada).
      const candidate = state.stops.concat(order);
      const sim = simulateRoute(
        request.depot,
        candidate,
        state.vehicle,
        departureMin,
        state.rangeBudgetKm,
      );
      if (!sim) {
        lastRejection = state.vehicle.isElectric
          ? "Fuera de autonomía EV, ventana horaria o jornada máxima"
          : "Fuera de ventana horaria o jornada máxima";
        continue;
      }

      const last = state.stops[state.stops.length - 1];
      const from = last ? last.location : request.depot;
      const cost = roadDistanceKm(from, order.location);
      if (cost < bestCost) {
        bestCost = cost;
        bestState = state;
      }
    }

    if (bestState) {
      bestState.stops.push(order);
      bestState.loadKg += order.weightKg;
      bestState.loadM3 += order.volumeM3 ?? 0;
    } else {
      unassigned.push({ orderId: order.id, reason: lastRejection });
    }
  }

  const routes: PlannedRoute[] = [];
  for (const state of states) {
    if (state.stops.length === 0) continue;

    const improved = twoOptImprove(
      request.depot,
      state.stops,
      state.vehicle,
      departureMin,
      state.rangeBudgetKm,
    );
    const sim = simulateRoute(
      request.depot,
      improved,
      state.vehicle,
      departureMin,
      state.rangeBudgetKm,
    );
    if (!sim) continue; // no debería ocurrir: improved siempre es factible

    const stops: PlannedStop[] = improved.map((order, i) => ({
      orderId: order.id,
      sequence: i + 1,
      etaMin: Math.round(sim.etas[i]!),
      distanceFromPrevKm: Number(sim.legDistances[i]!.toFixed(2)),
    }));

    routes.push({
      vehicleId: state.vehicle.id,
      stops,
      totalDistanceKm: Number(sim.totalDistanceKm.toFixed(2)),
      totalDurationMin: Math.round(sim.totalDurationMin),
      loadKg: Number(state.loadKg.toFixed(2)),
      warnings: state.warnings,
    });
  }

  return { routes, unassigned, excludedVehicles };
}
