import type { VehicleType } from "./enums.js";

/**
 * Factores de emisión de CO₂e de la flota urbana, base del informe verde
 * mensual (argumento de venta ESG ante los negocios cliente).
 *
 * Fuentes de referencia (aproximaciones conservadoras para LatAm urbano):
 *  - Combustión: factores well-to-wheel típicos por tipo de vehículo urbano.
 *  - Eléctricos: consumo (kWh/km) × factor de emisión de la red colombiana,
 *    una de las más limpias de la región por su matriz hídrica (XM ~0.126
 *    kg CO₂e/kWh promedio). Por eso electrificar última milla en Colombia
 *    ahorra >80 % frente a gasolina.
 */
export const GRID_CO2_KG_PER_KWH = 0.126;

export interface VehicleEmissionProfile {
  /** Combustión interna: kg CO₂e por km recorrido. */
  iceKgPerKm: number;
  /** Eléctrico: consumo en kWh por km (se multiplica por el factor de red). */
  evKwhPerKm: number;
}

export const VEHICLE_EMISSIONS: Record<VehicleType, VehicleEmissionProfile> = {
  MOTO: { iceKgPerKm: 0.075, evKwhPerKm: 0.04 },
  BICICLETA: { iceKgPerKm: 0, evKwhPerKm: 0.012 },
  CARRO: { iceKgPerKm: 0.192, evKwhPerKm: 0.16 },
  VAN: { iceKgPerKm: 0.245, evKwhPerKm: 0.28 },
  CAMION: { iceKgPerKm: 0.515, evKwhPerKm: 0.9 },
};

/** kg CO₂e emitidos por `km` recorridos con el tipo/propulsión dados. */
export function co2KgForKm(
  type: VehicleType,
  isElectric: boolean,
  km: number,
): number {
  const profile = VEHICLE_EMISSIONS[type];
  if (!profile) return 0;
  return isElectric
    ? profile.evKwhPerKm * GRID_CO2_KG_PER_KWH * km
    : profile.iceKgPerKm * km;
}

/**
 * Línea base contra la que se mide el ahorro: el mismo recorrido hecho con el
 * equivalente de combustión que el mercado usaría (una bicicleta o moto
 * eléctrica desplaza una moto a gasolina; un EV desplaza su versión a
 * combustión del mismo tipo).
 */
export function co2BaselineKgForKm(type: VehicleType, km: number): number {
  const baselineType: VehicleType = type === "BICICLETA" ? "MOTO" : type;
  return VEHICLE_EMISSIONS[baselineType].iceKgPerKm * km;
}

/** Absorción anual aproximada de un árbol urbano (kg CO₂/año). */
export const TREE_ABSORPTION_KG_PER_YEAR = 21;
