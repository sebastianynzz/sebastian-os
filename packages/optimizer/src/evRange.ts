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
