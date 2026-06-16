import {
  VEHICLE_TYPE_PROFILES,
  configSupportsTempProfile,
  type LatLng,
  type TempProfile,
  type VehicleType,
} from "@moveos/shared";
import { checkPicoYPlaca } from "./picoYPlaca.js";
import { estimateUsableRangeKm } from "./evRange.js";
import { haversineTravelModel, type TravelModel } from "./travel.js";
import type {
  OptimizableOrder,
  OptimizableVehicle,
  PlanRequest,
  PlanResult,
  PlannedRoute,
  PlannedStop,
} from "./types.js";

const DEFAULT_SERVICE_TIME_MIN = 6;
const DEFAULT_DEPARTURE_MIN = 8 * 60;
/** Jornada máxima de una ruta (minutos). */
const MAX_ROUTE_DURATION_MIN = 10 * 60;

/**
 * Capacidad por configuración leída del catálogo (`VEHICLE_TYPE_PROFILES`),
 * sin segunda copia. El flatbed (volumen `null`) ignora la restricción de
 * volumen: se limita por peso (y por área de plataforma cuando se conozca).
 */
export function capacityOk(
  type: VehicleType,
  loadKg: number,
  loadM3: number,
): boolean {
  const p = VEHICLE_TYPE_PROFILES[type];
  if (loadKg > p.payloadKg) return false;
  if (p.cargoVolumeM3 != null && loadM3 > p.cargoVolumeM3) return false;
  return true;
}

/**
 * Factibilidad de cadena de frío: un vehículo puede servir un pedido solo si
 * cubre su perfil térmico. AMBIENT (o ausente) → cualquier vehículo. FROZEN →
 * solo RAP_MOVE_COLD_BOX; CHILLED → cualquiera de las dos Cold Box.
 */
export function reeferOk(
  type: VehicleType,
  orderTempProfile?: TempProfile,
): boolean {
  if (!orderTempProfile || orderTempProfile === "AMBIENT") return true;
  return configSupportsTempProfile(type, orderTempProfile);
}

/** Razón en español de una asignación de cadena de frío infactible. */
function reeferRejectionReason(type: VehicleType, profile: TempProfile): string {
  const r = VEHICLE_TYPE_PROFILES[type].reefer;
  if (!r) return `Requiere cadena de frío ${profile}; vehículo no refrigerado`;
  return `Vehículo refrigerado no soporta ${profile} (solo ${r.modes.join("/")})`;
}

interface VehicleState {
  vehicle: OptimizableVehicle;
  stops: OptimizableOrder[];
  loadKg: number;
  loadM3: number;
  /** Presupuesto de distancia (km). Infinity para combustión. */
  rangeBudgetKm: number;
  warnings: string[];
}

/** Contexto compartido de simulación (planificación e inserción dinámica). */
interface SimContext {
  /** Punto de partida (depósito, o última parada atendida en inserciones). */
  start: LatLng;
  /** Punto de regreso al final (normalmente el depósito). */
  returnTo: LatLng;
  vehicle: OptimizableVehicle;
  departureMin: number;
  rangeBudgetKm: number;
  /** Jornada máxima permitida desde departureMin. */
  maxDurationMin: number;
  travel: TravelModel;
}

interface SimStop {
  orderId: string;
  kind: "PICKUP" | "DELIVERY";
  etaMin: number;
  legKm: number;
}

interface SimResult {
  stops: SimStop[];
  totalDistanceKm: number;
  totalDurationMin: number;
}

/**
 * Simula la secuencia (start → paradas → returnTo) y devuelve métricas por
 * parada, o null si viola ventanas horarias, jornada máxima o autonomía.
 *
 * Cada pedido con `pickupLocation` produce DOS paradas adyacentes (PICKUP
 * luego DELIVERY); así la precedencia queda garantizada por construcción y el
 * 2-opt nunca puede separar el par (reordena pedidos completos, no paradas).
 */
function simulateRoute(ctx: SimContext, orders: OptimizableOrder[]): SimResult | null {
  let clock = ctx.departureMin;
  let prev = ctx.start;
  let totalKm = 0;
  const stops: SimStop[] = [];
  const serviceTime = (o: OptimizableOrder) =>
    o.serviceTimeMin ?? DEFAULT_SERVICE_TIME_MIN;

  const visit = (
    orderId: string,
    kind: "PICKUP" | "DELIVERY",
    point: LatLng,
    timeWindow: { startMin: number; endMin: number } | undefined,
    service: number,
  ): boolean => {
    const legKm = ctx.travel.distanceKm(prev, point);
    totalKm += legKm;
    clock += ctx.travel.travelMin(prev, point, ctx.vehicle.type);
    // La ventana horaria aplica a la entrega (no a la recogida).
    if (timeWindow) {
      if (clock > timeWindow.endMin) return false;
      if (clock < timeWindow.startMin) clock = timeWindow.startMin;
    }
    stops.push({ orderId, kind, etaMin: clock, legKm });
    clock += service;
    prev = point;
    return true;
  };

  for (const order of orders) {
    if (order.pickupLocation) {
      // Recoger primero (sin ventana horaria; la ventana es para la entrega).
      if (!visit(order.id, "PICKUP", order.pickupLocation, undefined, serviceTime(order)))
        return null;
    }
    if (!visit(order.id, "DELIVERY", order.location, order.timeWindow, serviceTime(order)))
      return null;
  }

  // Regreso al punto final (normalmente el depósito).
  totalKm += ctx.travel.distanceKm(prev, ctx.returnTo);
  clock += ctx.travel.travelMin(prev, ctx.returnTo, ctx.vehicle.type);

  if (totalKm > ctx.rangeBudgetKm) return null;
  if (clock - ctx.departureMin > ctx.maxDurationMin) return null;

  return { stops, totalDistanceKm: totalKm, totalDurationMin: clock - ctx.departureMin };
}

/**
 * Mejora 2-opt: invierte segmentos de la secuencia si reduce distancia total
 * sin violar la factibilidad (ventanas horarias, autonomía, jornada).
 */
function twoOptImprove(
  ctx: SimContext,
  stops: OptimizableOrder[],
): OptimizableOrder[] {
  let best = stops.slice();
  let bestSim = simulateRoute(ctx, best);
  if (!bestSim) return best;

  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = best
          .slice(0, i)
          .concat(best.slice(i, j + 1).reverse(), best.slice(j + 1));
        const sim = simulateRoute(ctx, candidate);
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
  const travel = request.travel ?? haversineTravelModel();
  const excludedVehicles: PlanResult["excludedVehicles"] = [];
  const states: VehicleState[] = [];

  const ctxFor = (state: VehicleState): SimContext => ({
    start: request.depot,
    returnTo: request.depot,
    vehicle: state.vehicle,
    departureMin,
    rangeBudgetKm: state.rangeBudgetKm,
    maxDurationMin: MAX_ROUTE_DURATION_MIN,
    travel,
  });

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
      // Cadena de frío: compatibilidad dura vehículo↔pedido (antes que carga).
      if (!reeferOk(state.vehicle.type, order.tempProfile)) {
        lastRejection = reeferRejectionReason(
          state.vehicle.type,
          order.tempProfile!,
        );
        continue;
      }
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
      const sim = simulateRoute(ctxFor(state), candidate);
      if (!sim) {
        lastRejection = state.vehicle.isElectric
          ? "Fuera de autonomía EV, ventana horaria o jornada máxima"
          : "Fuera de ventana horaria o jornada máxima";
        continue;
      }

      const last = state.stops[state.stops.length - 1];
      const from = last ? last.location : request.depot;
      const cost = travel.distanceKm(from, order.location);
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

    const ctx = ctxFor(state);
    const improved = twoOptImprove(ctx, state.stops);
    const sim = simulateRoute(ctx, improved);
    if (!sim) continue; // no debería ocurrir: improved siempre es factible

    const stops: PlannedStop[] = sim.stops.map((s, i) => ({
      orderId: s.orderId,
      kind: s.kind,
      sequence: i + 1,
      etaMin: Math.round(s.etaMin),
      distanceFromPrevKm: Number(s.legKm.toFixed(2)),
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

export interface InsertRequest {
  /**
   * Pedidos PENDIENTES de la ruta en su orden actual (la "cola" aún no
   * atendida). Los pedidos ya recogidos deben venir sin pickupLocation.
   */
  pendingOrders: OptimizableOrder[];
  /** Pedido nuevo a insertar (express / mismo día). */
  newOrder: OptimizableOrder;
  vehicle: OptimizableVehicle;
  /** Punto de partida: depósito, o la última parada atendida si va en ruta. */
  start: LatLng;
  /** Punto de regreso (depósito). */
  returnTo: LatLng;
  /** Reloj de partida en minutos desde medianoche (hora local). */
  departureMin: number;
  /**
   * Presupuesto de autonomía restante (km). Para EV en ruta: recalcular desde
   * el SoC actual reportado por telemetría — cubre exactamente lo que falta.
   */
  rangeBudgetKm: number;
  /** Carga ya a bordo + pendiente (kg) ANTES de insertar el nuevo pedido. */
  currentLoadKg: number;
  /** Tiempo máximo restante de jornada (minutos). */
  maxDurationMin?: number;
  travel?: TravelModel;
}

export interface InsertResult {
  /** Cola resultante con el pedido insertado en la mejor posición. */
  orders: OptimizableOrder[];
  /** Paradas simuladas (con ETA y km por tramo) de la cola resultante. */
  stops: PlannedStop[];
  totalDistanceKm: number;
  totalDurationMin: number;
  /** Posición (índice en la cola) donde quedó el pedido nuevo. */
  insertedAt: number;
}

/**
 * Inserción dinámica (express / mismo día): prueba el pedido nuevo en cada
 * posición de la cola pendiente, valida factibilidad completa (capacidad,
 * ventanas, autonomía, jornada) y devuelve la posición de menor distancia
 * total, o null si no cabe en ninguna. La precedencia pickup→delivery del
 * pedido nuevo queda garantizada por construcción (el par viaja junto).
 */
export function insertOrderIntoRoute(req: InsertRequest): InsertResult | null {
  const travel = req.travel ?? haversineTravelModel();

  // Cadena de frío: no insertar un pedido refrigerado en un vehículo que no
  // cubre su perfil (FROZEN→solo RAP_MOVE_COLD_BOX, CHILLED→cualquier Cold Box).
  if (!reeferOk(req.vehicle.type, req.newOrder.tempProfile)) {
    return null;
  }

  if (req.currentLoadKg + req.newOrder.weightKg > req.vehicle.capacityKg) {
    return null; // capacidad de peso excedida
  }

  const ctx: SimContext = {
    start: req.start,
    returnTo: req.returnTo,
    vehicle: req.vehicle,
    departureMin: req.departureMin,
    rangeBudgetKm: req.rangeBudgetKm,
    maxDurationMin: req.maxDurationMin ?? MAX_ROUTE_DURATION_MIN,
    travel,
  };

  let best: { orders: OptimizableOrder[]; sim: SimResult; at: number } | null = null;
  for (let at = 0; at <= req.pendingOrders.length; at++) {
    const candidate = req.pendingOrders
      .slice(0, at)
      .concat(req.newOrder, req.pendingOrders.slice(at));
    const sim = simulateRoute(ctx, candidate);
    if (sim && (!best || sim.totalDistanceKm < best.sim.totalDistanceKm - 1e-9)) {
      best = { orders: candidate, sim, at };
    }
  }
  if (!best) return null;

  return {
    orders: best.orders,
    stops: best.sim.stops.map((s, i) => ({
      orderId: s.orderId,
      kind: s.kind,
      sequence: i + 1,
      etaMin: Math.round(s.etaMin),
      distanceFromPrevKm: Number(s.legKm.toFixed(2)),
    })),
    totalDistanceKm: Number(best.sim.totalDistanceKm.toFixed(2)),
    totalDurationMin: Math.round(best.sim.totalDurationMin),
    insertedAt: best.at,
  };
}
