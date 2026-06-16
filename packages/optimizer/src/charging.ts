import type { VehicleType } from "@moveos/shared";

/**
 * Programador de carga EV (núcleo eléctrico). Determinista, sin LLM: para cada
 * vehículo calcula cuánta energía recargar y en qué ventana tarifaria horaria
 * (time-of-use) hacerlo al menor costo, garantizando que llegue con autonomía
 * para la operación del día siguiente. La energía a cargar incluye el consumo
 * del reefer cuando aplica (lo agrega quien llama). Es el solver de
 * `optimize_charging`.
 */

export interface TariffWindow {
  label: string;
  startHour: number; // 0-23 (puede cruzar medianoche: start > end)
  endHour: number;
  copPerKwh: number;
}

/**
 * Tarifa horaria por defecto (aprox. Colombia): valle nocturno barato, llano
 * diurno, punta en la tarde. En producción se parametriza por comercializador.
 */
export const DEFAULT_TARIFF: TariffWindow[] = [
  { label: "Valle (noche)", startHour: 22, endHour: 6, copPerKwh: 480 },
  { label: "Llano (día)", startHour: 6, endHour: 18, copPerKwh: 720 },
  { label: "Punta (tarde)", startHour: 18, endHour: 22, copPerKwh: 980 },
];

export interface ChargeVehicleInput {
  id: string;
  type: VehicleType;
  batteryKwh: number;
  socPercent: number;
  /** Energía requerida para la operación del día siguiente (kWh, incl. reefer). */
  energyNeedKwh: number;
}

export interface ChargePlanItem {
  vehicleId: string;
  fromSocPct: number;
  targetSocPct: number;
  energyKwh: number; // a cargar
  window: string; // ventana tarifaria elegida (la más barata)
  copPerKwh: number;
  estCostCop: number;
  ready: boolean; // la batería alcanza para la ruta del día siguiente
  reasonEs: string;
}

export interface ChargeResult {
  plans: ChargePlanItem[];
  totalEnergyKwh: number;
  totalCostCop: number;
  /** Vehículos cuya ruta NO cabe en la batería (riesgo de quedarse sin carga). */
  atRisk: string[];
}

/** Margen de seguridad de energía sobre la necesidad estimada. */
const SAFETY = 1.15;

export function planCharging(
  vehicles: ChargeVehicleInput[],
  tariffs: TariffWindow[] = DEFAULT_TARIFF,
): ChargeResult {
  const cheapest = tariffs.reduce((a, b) => (b.copPerKwh < a.copPerKwh ? b : a));

  const plans: ChargePlanItem[] = vehicles.map((v) => {
    const currentKwh = v.batteryKwh * (v.socPercent / 100);
    const targetKwh = Math.min(v.batteryKwh, v.energyNeedKwh * SAFETY);
    const toChargeKwh = Math.max(0, targetKwh - currentKwh);
    const targetSocPct = Math.round(
      (Math.min(v.batteryKwh, currentKwh + toChargeKwh) / v.batteryKwh) * 100,
    );
    // La ruta cabe en la batería si la energía necesaria no supera su capacidad.
    const ready = v.energyNeedKwh <= v.batteryKwh;
    const estCostCop = Math.round(toChargeKwh * cheapest.copPerKwh);

    let reasonEs: string;
    if (!ready) {
      reasonEs = `La ruta del día (${v.energyNeedKwh.toFixed(1)} kWh) excede la batería (${v.batteryKwh} kWh): dividir la ruta o cambiar de vehículo`;
    } else if (toChargeKwh <= 0.01) {
      reasonEs = "Carga suficiente; no requiere recarga";
    } else {
      reasonEs = `Cargar ${toChargeKwh.toFixed(1)} kWh en ${cheapest.label} (${cheapest.copPerKwh} COP/kWh)`;
    }

    return {
      vehicleId: v.id,
      fromSocPct: Math.round(v.socPercent),
      targetSocPct,
      energyKwh: Number(toChargeKwh.toFixed(2)),
      window: cheapest.label,
      copPerKwh: cheapest.copPerKwh,
      estCostCop,
      ready,
      reasonEs,
    };
  });

  return {
    plans,
    totalEnergyKwh: Number(plans.reduce((a, p) => a + p.energyKwh, 0).toFixed(2)),
    totalCostCop: plans.reduce((a, p) => a + p.estCostCop, 0),
    atRisk: plans.filter((p) => !p.ready).map((p) => p.vehicleId),
  };
}
