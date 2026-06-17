import {
  VEHICLE_TYPES,
  VEHICLE_TYPE_PROFILES,
  configSupportsTempProfile,
  type TempProfile,
  type VehicleType,
} from "@moveos/shared";

/**
 * Ranking de las 6 configuraciones EV para una ruta o clúster de pedidos.
 * Determinista, sin LLM. Valora ajuste de peso/volumen, margen de autonomía
 * (usando el mejor pack disponible), compatibilidad de cadena de frío y, para
 * carga sobredimensionada, prefiere el flatbed. Es el solver de `pick_vehicle`.
 */

export interface PickRequest {
  totalKg: number;
  totalM3?: number;
  /** Necesidad térmica del clúster (el más exigente). */
  coldChain?: TempProfile;
  /** Distancia estimada de la ruta (km) para el margen de autonomía. */
  distanceKm?: number;
  /** Carga voluminosa/irregular → favorece el flatbed. */
  oversized?: boolean;
}

export interface RankedConfig {
  type: VehicleType;
  labelEs: string;
  feasible: boolean;
  score: number;
  reasonEs: string;
  utilizationPct: number;
  rangeMarginKm: number;
  /** Pack mínimo de batería que cubre la distancia (kWh), si aplica. */
  requiredBatteryKwh?: number;
}

/** Margen de seguridad de autonomía aplicado al rango nominal del mejor pack. */
const RANGE_SAFETY = 0.85;

export function rankVehicleConfigs(req: PickRequest): RankedConfig[] {
  const ranked: RankedConfig[] = VEHICLE_TYPES.map((type) => {
    const p = VEHICLE_TYPE_PROFILES[type];
    const isFlatbed = p.body === "OPEN_FLATBED";
    const reasons: string[] = [];

    // Capacidad de peso.
    const weightOk = req.totalKg <= p.payloadKg;
    if (!weightOk)
      reasons.push(`excede payload (${req.totalKg}>${p.payloadKg} kg)`);

    // Capacidad de volumen (flatbed la ignora).
    const volumeOk =
      isFlatbed || p.cargoVolumeM3 == null || (req.totalM3 ?? 0) <= p.cargoVolumeM3;
    if (!volumeOk)
      reasons.push(`excede volumen (${req.totalM3}>${p.cargoVolumeM3} m³)`);

    // Cadena de frío.
    const coldOk =
      !req.coldChain ||
      req.coldChain === "AMBIENT" ||
      configSupportsTempProfile(type, req.coldChain);
    if (!coldOk) reasons.push(`no soporta cadena de frío ${req.coldChain}`);

    // Autonomía: usar el MEJOR pack disponible (se puede elegir batería).
    const bestPack = p.batteryOptions.reduce((a, b) =>
      b.rangeKm > a.rangeKm ? b : a,
    );
    const usableKm = bestPack.rangeKm * RANGE_SAFETY;
    const rangeMarginKm = Number((usableKm - (req.distanceKm ?? 0)).toFixed(1));
    const rangeOk = req.distanceKm == null || rangeMarginKm >= 0;
    if (!rangeOk)
      reasons.push(`autonomía insuficiente (${usableKm.toFixed(0)}<${req.distanceKm} km)`);

    const feasible = weightOk && volumeOk && coldOk && rangeOk;

    // Pack mínimo que cubre la distancia (para sugerir batería).
    const requiredBatteryKwh = req.distanceKm
      ? p.batteryOptions
          .slice()
          .sort((a, b) => a.rangeKm - b.rangeKm)
          .find((o) => o.rangeKm * RANGE_SAFETY >= req.distanceKm!)?.batteryKwh
      : p.batteryOptions[0]!.batteryKwh;

    const utilByWeight = p.payloadKg > 0 ? req.totalKg / p.payloadKg : 0;
    const utilizationPct = Math.round(Math.min(utilByWeight, 1) * 100);

    // Puntaje: solo entre factibles. Premia ajuste ceñido (≈80% util),
    // exactitud de frío (no “sobre-equipar” con Cold Box si no se pide),
    // margen de autonomía sano y, si es sobredimensionado, el flatbed.
    let score = -1;
    if (feasible) {
      score = 1 - Math.abs(0.8 - Math.min(utilByWeight, 1)); // 0..1
      if (req.coldChain && req.coldChain !== "AMBIENT") {
        score += 0.3; // cumple frío (todas las factibles lo cumplen, refuerza)
      } else if (p.reefer) {
        score -= 0.25; // carga seca en una Cold Box: desperdicia capacidad de frío
      }
      if (req.oversized) score += isFlatbed ? 0.6 : -0.4;
      // Carga con volumen cerrado prefiere caja cerrada sobre plataforma abierta.
      if ((req.totalM3 ?? 0) > 0 && !isFlatbed) score += 0.05;
      // Pequeño bono por margen de autonomía holgado (sin exagerar).
      score += Math.min(rangeMarginKm, 100) / 1000;
    }

    const reasonEs = feasible
      ? `Apto: ${utilizationPct}% de carga, margen de autonomía ${rangeMarginKm} km${
          p.reefer ? `, cadena de frío ${p.reefer.modes.join("/")}` : ""
        }`
      : `No apto: ${reasons.join("; ")}`;

    return {
      type,
      labelEs: p.labelEs,
      feasible,
      score: Number(score.toFixed(4)),
      reasonEs,
      utilizationPct,
      rangeMarginKm,
      requiredBatteryKwh,
    };
  });

  // Factibles primero (mayor score); luego no factibles.
  return ranked.sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    return b.score - a.score;
  });
}
