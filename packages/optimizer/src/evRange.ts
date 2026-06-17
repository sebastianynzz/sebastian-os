/**
 * Modelo de autonomía dinámica para vehículos eléctricos.
 *
 * La autonomía real de un EV puede estar 30-40% por debajo de la nominal.
 * Este modelo aplica factores de corrección basados en reglas de la industria:
 *  - Temperatura: ~1.5% menos autonomía por cada 5.5°C por debajo de 21°C.
 *  - Carga útil: ~1% menos por cada 90 kg de carga.
 *  - Elevación: ~3-5% menos por cada 300 m de ganancia de altura
 *    (relevante en Bogotá: 2.640 msnm y topografía quebrada).
 *
 * El resultado se multiplica por el SoC actual y un margen de seguridad.
 */

import { VEHICLE_TYPE_PROFILES, type VehicleType } from "@moveos/shared";

export interface EvRangeInput {
  nominalRangeKm: number;
  socPercent: number;
  temperatureC?: number;
  payloadKg?: number;
  elevationGainM?: number;
  /** Margen de seguridad (fracción de la autonomía que se reserva). */
  safetyMargin?: number;
}

export const DEFAULT_EV_SAFETY_MARGIN = 0.15;

export function estimateUsableRangeKm(input: EvRangeInput): number {
  const {
    nominalRangeKm,
    socPercent,
    temperatureC = 21,
    payloadKg = 0,
    elevationGainM = 0,
    safetyMargin = DEFAULT_EV_SAFETY_MARGIN,
  } = input;

  let factor = 1;

  if (temperatureC < 21) {
    const degreesBelow = 21 - temperatureC;
    factor -= 0.015 * (degreesBelow / 5.5);
  }

  factor -= 0.01 * (payloadKg / 90);
  factor -= 0.04 * (elevationGainM / 300);

  factor = Math.max(factor, 0.4); // piso: nunca menos del 40% de la nominal

  const usable =
    nominalRangeKm * factor * (socPercent / 100) * (1 - safetyMargin);
  return Math.max(usable, 0);
}

/** Vehículo mínimo para resolver autonomía nominal desde el catálogo. */
export interface RangeResolvable {
  type: VehicleType;
  /** Override explícito de autonomía nominal (km). */
  nominalRangeKm?: number | null;
  /** Pack instalado (IONAx: 11.52 o 23.04 kWh). */
  batteryKwh?: number | null;
}

/**
 * Resuelve la autonomía nominal a partir del pack instalado (maneja el doble
 * pack del IONAx: 11.52 kWh → 130 km, 23.04 kWh → 260 km). Si hay override
 * explícito se respeta; si no se reconoce el pack, cae al más conservador
 * (el más pequeño). Confirmado: todas las autonomías ya son "reefer-on", por
 * lo que NO se descuenta consumo de refrigeración aquí.
 */
export function resolveNominalRangeKm(vehicle: RangeResolvable): number {
  if (vehicle.nominalRangeKm) return vehicle.nominalRangeKm; // override explícito
  const opts = VEHICLE_TYPE_PROFILES[vehicle.type].batteryOptions;
  const match = vehicle.batteryKwh
    ? opts.find((o) => Math.abs(o.batteryKwh - vehicle.batteryKwh!) < 0.01)
    : undefined;
  return (match ?? opts[0]!).rangeKm; // por defecto el pack más pequeño/conservador
}

/**
 * Energía de refrigeración (kWh) consumida por una Cold Box con el reefer
 * encendido `hoursRunning` horas. SOLO para analítica de energía/costo —
 * NUNCA como penalización de autonomía (las autonomías ya son reefer-on).
 */
export function reeferEnergyKwh(
  type: VehicleType,
  hoursRunning: number,
): number {
  const r = VEHICLE_TYPE_PROFILES[type].reefer;
  if (!r) return 0;
  const draw = Array.isArray(r.coolingDrawKw)
    ? (r.coolingDrawKw[0] + r.coolingDrawKw[1]) / 2
    : r.coolingDrawKw;
  return draw * hoursRunning;
}
