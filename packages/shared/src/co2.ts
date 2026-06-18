import { VEHICLE_TYPES, type VehicleType } from "./enums.js";
import { VEHICLE_TYPE_PROFILES } from "./vehicleTypeProfiles.js";

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

/**
 * Línea base de combustión (kg CO₂e/km) que cada configuración EV DESPLAZA.
 * Existe SOLO como contrafactual de "emisiones evitadas" (CLAUDE.md 1.6): es
 * el vehículo a gasolina/diésel que el mercado usaría para el mismo trabajo,
 * nunca un vehículo real de MoveOS. Las Rap Move desplazan motos/moto-carga a
 * gasolina; las IONAx, vans/pickups utilitarias a combustión (la Cold Box
 * carga un extra por la refrigeración a combustible).
 */
const ICE_BASELINE_KG_PER_KM: Record<VehicleType, number> = {
  RAP_MOVE_LIGHT: 0.075,
  RAP_MOVE_XL: 0.115,
  RAP_MOVE_COLD_BOX: 0.13,
  IONAX: 0.245,
  IONAX_COLD_BOX: 0.27,
  IONAX_PICKUP: 0.245,
};

/**
 * Consumo eléctrico (kWh/km) derivado del perfil del vehículo
 * (batería del pack base / autonomía nominal) — una sola fuente de verdad,
 * sin segunda copia hardcodeada.
 */
export const VEHICLE_EMISSIONS: Record<VehicleType, VehicleEmissionProfile> =
  Object.fromEntries(
    VEHICLE_TYPES.map((t) => {
      const p = VEHICLE_TYPE_PROFILES[t];
      return [
        t,
        {
          iceKgPerKm: ICE_BASELINE_KG_PER_KM[t],
          evKwhPerKm: p.batteryOptions[0]!.batteryKwh / p.nominalRangeKm,
        },
      ];
    }),
  ) as Record<VehicleType, VehicleEmissionProfile>;

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
 * equivalente de combustión que el mercado usaría para esa configuración
 * (contrafactual de "emisiones evitadas").
 */
export function co2BaselineKgForKm(type: VehicleType, km: number): number {
  return VEHICLE_EMISSIONS[type].iceKgPerKm * km;
}

/**
 * Energía eléctrica (kWh) consumida por un EV del tipo dado en `km`. Base del
 * costo energético por entrega (D6): la unidad de costo de MoveOS es la energía,
 * no el combustible (restricción dura 1.7).
 */
export function evKwhForKm(type: VehicleType, km: number): number {
  const profile = VEHICLE_EMISSIONS[type];
  return profile ? profile.evKwhPerKm * km : 0;
}

/** Absorción anual aproximada de un árbol urbano (kg CO₂/año). */
export const TREE_ABSORPTION_KG_PER_YEAR = 21;
