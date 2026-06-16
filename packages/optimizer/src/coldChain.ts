import type { TempProfile } from "@moveos/shared";

/**
 * Secuenciación de cadena de frío (módulo COLD_CHAIN). Determinista, sin LLM:
 * recomienda el orden de entrega de una ruta reefer priorizando los pedidos más
 * sensibles a temperatura (FROZEN antes que CHILLED antes que AMBIENT) para
 * minimizar el tiempo fuera de banda, y calcula el tiempo de pre-enfriamiento.
 * Es el solver de `optimize_cold_chain`.
 */

export interface ColdStopInput {
  orderId: string;
  tempProfile: TempProfile;
  /** ETA actual (min desde medianoche) — informativo. */
  etaMin?: number;
}

export interface ColdChainResult {
  /** orderIds en el orden recomendado (más sensible primero). */
  order: string[];
  movedCount: number;
  preCoolLeadMin: number;
  /** Heurística: % de entregas sensibles ubicadas en la primera mitad. */
  timeInBandPct: number;
  sensitiveCount: number;
  notesEs: string[];
}

const PRIORITY: Record<TempProfile, number> = { FROZEN: 0, CHILLED: 1, AMBIENT: 2 };
const PRECOOL_MIN: Record<TempProfile, number> = { FROZEN: 45, CHILLED: 30, AMBIENT: 0 };

export function sequenceColdChain(stops: ColdStopInput[]): ColdChainResult {
  const original = stops.map((s) => s.orderId);

  // Orden estable por prioridad térmica (sensibles primero, preservando el
  // orden relativo dentro de cada grupo).
  const sorted = stops
    .map((s, i) => ({ s, i }))
    .sort(
      (a, b) =>
        PRIORITY[a.s.tempProfile] - PRIORITY[b.s.tempProfile] || a.i - b.i,
    )
    .map((x) => x.s);

  const order = sorted.map((s) => s.orderId);
  let movedCount = 0;
  for (let i = 0; i < order.length; i++) {
    if (order[i] !== original[i]) movedCount++;
  }

  const sensitive = stops.filter((s) => s.tempProfile !== "AMBIENT");
  const half = Math.ceil(order.length / 2);
  const sensitiveEarly = sorted
    .slice(0, half)
    .filter((s) => s.tempProfile !== "AMBIENT").length;
  const timeInBandPct =
    sensitive.length === 0
      ? 100
      : Math.round((sensitiveEarly / sensitive.length) * 100);

  const preCoolLeadMin = stops.reduce(
    (max, s) => Math.max(max, PRECOOL_MIN[s.tempProfile]),
    0,
  );

  return {
    order,
    movedCount,
    preCoolLeadMin,
    timeInBandPct,
    sensitiveCount: sensitive.length,
    notesEs: [
      sensitive.length === 0
        ? "Sin pedidos sensibles a temperatura en la ruta"
        : `${sensitive.length} entrega(s) sensible(s): se priorizan al inicio para minimizar exposición`,
      preCoolLeadMin > 0
        ? `Pre-enfriar la caja ${preCoolLeadMin} min antes de salir`
        : "Sin pre-enfriamiento requerido",
    ],
  };
}
