import { roadDistanceKm, type LatLng, type VehicleType } from "@moveos/shared";

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
 * Velocidades urbanas promedio por tipo de vehículo (km/h), calibradas para
 * tráfico denso tipo Bogotá. Las motos son significativamente más rápidas en
 * congestión: esto hace que el optimizador prefiera motos en rutas urbanas.
 */
export const URBAN_SPEED_KMH: Record<VehicleType, number> = {
  MOTO: 22,
  BICICLETA: 13,
  CARRO: 17,
  VAN: 16,
  CAMION: 14,
};

/**
 * Factores de duración por tipo de vehículo sobre un tiempo base "carro"
 * (p. ej. duraciones OSRM, que modelan un automóvil). Heurística documentada:
 * la moto filtra entre el tráfico; el camión es más lento en maniobras.
 */
export const VEHICLE_DURATION_FACTOR: Record<VehicleType, number> = {
  MOTO: 0.8,
  BICICLETA: 2.2,
  CARRO: 1.0,
  VAN: 1.05,
  CAMION: 1.2,
};

/** Modelo por defecto: haversine × factor urbano + velocidades por tipo. */
export function haversineTravelModel(): TravelModel {
  return {
    distanceKm: (a, b) => roadDistanceKm(a, b),
    travelMin: (a, b, type) =>
      (roadDistanceKm(a, b) / URBAN_SPEED_KMH[type]) * 60,
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
      return durationsMinCar[i]![j]! * VEHICLE_DURATION_FACTOR[type];
    },
  };
}
