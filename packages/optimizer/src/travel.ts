import {
  roadDistanceKm,
  VEHICLE_TYPE_PROFILES,
  type LatLng,
  type VehicleType,
} from "@moveos/shared";

/**
 * Modelo de viaje conectable: separa el "cuánto se tarda / cuánta distancia"
 * del solver. La lógica de restricciones (pico y placa, rango EV, ventanas)
 * NO cambia según el modelo — solo cambian distancias y tiempos.
 *
 * Implementaciones:
 *  - haversineTravelModel(): heurística sin infraestructura (haversine × 1.4
 *    + velocidades urbanas por tipo de vehículo). Comportamiento histórico.
 *  - Matriz OSRM (construida en la API): distancias/tiempos por red vial real,
 *    con fallback automático a haversine para pares fuera de la matriz.
 */

export interface TravelModel {
  /** Distancia por vía en kilómetros. */
  distanceKm(a: LatLng, b: LatLng): number;
  /** Tiempo de viaje en minutos para un tipo de vehículo. */
  travelMin(a: LatLng, b: LatLng, vehicleType: VehicleType): number;
}

/**
 * Velocidad base urbana densa (km/h) para una configuración de referencia en
 * el modelo haversine. Sobre ella se aplica `durationFactor(type)` por
 * configuración. Calibrada para tráfico tipo Bogotá.
 */
export const BASE_URBAN_KMH = 18;

/**
 * Línea base de velocidad libre (km/h) para derivar factores relativos por
 * configuración desde el catálogo (`topSpeedKmh` × `agilityFactor`).
 */
const FREE_SPEED_BASELINE_KMH = 75;

/**
 * Factor de velocidad relativo de una configuración (>1 = más rápida que la
 * línea base, <1 = más lenta). Derivado del perfil del vehículo
 * (`topSpeedKmh`, `agilityFactor`) — sin segunda copia hardcodeada.
 * Primera aproximación; calibrar contra OSRM más adelante.
 */
export function speedFactor(type: VehicleType): number {
  const p = VEHICLE_TYPE_PROFILES[type];
  return (p.topSpeedKmh / FREE_SPEED_BASELINE_KMH) * p.agilityFactor;
}

/** Factor de duración (inverso de la velocidad): multiplica el tiempo de viaje. */
export function durationFactor(type: VehicleType): number {
  return 1 / speedFactor(type);
}

/** Modelo por defecto: haversine × factor urbano + factor de duración por tipo. */
export function haversineTravelModel(): TravelModel {
  return {
    distanceKm: (a, b) => roadDistanceKm(a, b),
    travelMin: (a, b, type) =>
      (roadDistanceKm(a, b) / BASE_URBAN_KMH) * 60 * durationFactor(type),
  };
}

const keyOf = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

/**
 * Modelo basado en una matriz precalculada (p. ej. OSRM /table) sobre un
 * conjunto de puntos conocido. Para pares fuera de la matriz cae al modelo
 * haversine (robustez ante puntos nuevos, p. ej. inserciones).
 */
export function matrixTravelModel(
  points: LatLng[],
  distancesKm: number[][],
  durationsMinCar: number[][],
): TravelModel {
  const index = new Map<string, number>();
  points.forEach((p, i) => index.set(keyOf(p), i));
  const fallback = haversineTravelModel();

  return {
    distanceKm(a, b) {
      const i = index.get(keyOf(a));
      const j = index.get(keyOf(b));
      if (i === undefined || j === undefined) return fallback.distanceKm(a, b);
      return distancesKm[i]![j]!;
    },
    travelMin(a, b, type) {
      const i = index.get(keyOf(a));
      const j = index.get(keyOf(b));
      if (i === undefined || j === undefined) return fallback.travelMin(a, b, type);
      return durationsMinCar[i]![j]! * durationFactor(type);
    },
  };
}
