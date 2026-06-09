import type { LatLng, VehicleType } from "@moveos/shared";

export interface OptimizableOrder {
  id: string;
  location: LatLng;
  weightKg: number;
  volumeM3?: number;
  /** Ventana horaria en minutos desde medianoche (hora local). */
  timeWindow?: { startMin: number; endMin: number };
  priority: number;
  /** Tiempo de servicio en la parada (minutos). */
  serviceTimeMin?: number;
}

export interface OptimizableVehicle {
  id: string;
  plate: string;
  type: VehicleType;
  capacityKg: number;
  capacityM3?: number;
  isElectric: boolean;
  /** Autonomía nominal del fabricante (km). Solo EV. */
  nominalRangeKm?: number;
  /** Estado de carga actual 0-100. Solo EV. */
  socPercent?: number;
}

export interface PlanRequest {
  /** Fecha del plan (para evaluar pico y placa). */
  date: Date;
  city: string;
  depot: LatLng;
  /** Hora de salida en minutos desde medianoche. Por defecto 8:00. */
  departureMin?: number;
  orders: OptimizableOrder[];
  vehicles: OptimizableVehicle[];
  /** Condiciones para el modelo de autonomía EV. */
  evConditions?: {
    temperatureC?: number;
    avgPayloadKg?: number;
    elevationGainM?: number;
  };
}

export interface PlannedStop {
  orderId: string;
  sequence: number;
  /** ETA en minutos desde medianoche. */
  etaMin: number;
  distanceFromPrevKm: number;
}

export interface PlannedRoute {
  vehicleId: string;
  stops: PlannedStop[];
  totalDistanceKm: number;
  totalDurationMin: number;
  loadKg: number;
  warnings: string[];
}

export interface PlanResult {
  routes: PlannedRoute[];
  unassigned: { orderId: string; reason: string }[];
  excludedVehicles: { vehicleId: string; reason: string }[];
}
