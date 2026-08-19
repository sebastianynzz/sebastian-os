import { VEHICLE_TYPE_PROFILES } from "@moveos/shared";

/**
 * Motor de reglas de pico y placa.
 *
 * Las reglas cambian con frecuencia por decreto municipal: este motor es
 * configurable por ciudad y las reglas por defecto reflejan el esquema vigente
 * al momento de escribir (verificar al desplegar en cada ciudad). Se conserva
 * el motor (CLAUDE.md), pero la flota daleGo es 100% eléctrica: toda
 * configuración del catálogo está exenta a nivel nacional (Ley 1964/2019), así
 * que la exención es la norma. Los tipos van como `string` para desacoplar las
 * reglas (categorías reales de placa, p. ej. ICE) del enum de la flota EV.
 */

export interface PicoYPlacaRule {
  city: string;
  /** Días de la semana con restricción (0=domingo ... 6=sábado). */
  days: number[];
  /** Hora de inicio y fin de la restricción, en minutos desde medianoche. */
  startMin: number;
  endMin: number;
  /** Categorías de vehículo a las que aplica la restricción (placa real). */
  appliesTo: string[];
  /**
   * Función que decide los últimos dígitos restringidos para una fecha dada.
   * Devuelve el conjunto de últimos dígitos de placa que NO pueden circular.
   */
  restrictedDigits: (date: Date) => Set<number>;
}

/**
 * Bogotá (esquema día par/impar): los días pares no circulan placas terminadas
 * en dígito par; los días impares, placas terminadas en dígito impar.
 * Lunes a viernes, 6:00–21:00. Motos exentas.
 */
export const BOGOTA_RULE: PicoYPlacaRule = {
  city: "Bogotá",
  days: [1, 2, 3, 4, 5],
  startMin: 6 * 60,
  endMin: 21 * 60,
  appliesTo: ["CARRO", "VAN", "CAMION"],
  restrictedDigits: (date) => {
    const dayOfMonth = date.getDate();
    return dayOfMonth % 2 === 0
      ? new Set([0, 2, 4, 6, 8])
      : new Set([1, 3, 5, 7, 9]);
  },
};

/**
 * Medellín (rotación semestral por dígito): se modela con una rotación de
 * ejemplo; en producción la tabla se actualiza por decreto cada semestre.
 */
export const MEDELLIN_RULE: PicoYPlacaRule = {
  city: "Medellín",
  days: [1, 2, 3, 4, 5],
  startMin: 5 * 60,
  endMin: 20 * 60,
  appliesTo: ["CARRO", "VAN", "CAMION", "MOTO"],
  restrictedDigits: (date) => {
    const rotation: Record<number, number[]> = {
      1: [6, 9],
      2: [5, 7],
      3: [1, 8],
      4: [0, 2],
      5: [3, 4],
    };
    return new Set(rotation[date.getDay()] ?? []);
  },
};

const DEFAULT_RULES: PicoYPlacaRule[] = [BOGOTA_RULE, MEDELLIN_RULE];

export interface PicoYPlacaCheck {
  restricted: boolean;
  reason?: string;
}

export interface PicoYPlacaVehicle {
  plate: string;
  type: string;
  isElectric: boolean;
}

function lastDigit(plate: string): number | null {
  const matches = plate.match(/\d/g);
  if (!matches || matches.length === 0) return null;
  return Number(matches[matches.length - 1]);
}

/**
 * Evalúa si un vehículo puede circular en una ciudad/fecha/hora dadas.
 * `timeMin` es la hora del día en minutos desde medianoche.
 */
export function checkPicoYPlaca(
  vehicle: PicoYPlacaVehicle,
  city: string,
  date: Date,
  timeMin: number,
  rules: PicoYPlacaRule[] = DEFAULT_RULES,
): PicoYPlacaCheck {
  // Exención nacional para eléctricos (Ley 1964 de 2019). Toda la flota daleGo
  // es eléctrica: cualquier configuración del catálogo está exenta por defecto.
  const profile =
    VEHICLE_TYPE_PROFILES[vehicle.type as keyof typeof VEHICLE_TYPE_PROFILES];
  if (vehicle.isElectric || profile?.picoYPlacaExempt) {
    return { restricted: false, reason: "Exento (vehículo eléctrico)" };
  }

  const rule = rules.find(
    (r) => r.city.toLowerCase() === city.toLowerCase(),
  );
  if (!rule) return { restricted: false };

  if (!rule.appliesTo.includes(vehicle.type)) return { restricted: false };
  if (!rule.days.includes(date.getDay())) return { restricted: false };
  if (timeMin < rule.startMin || timeMin >= rule.endMin)
    return { restricted: false };

  const digit = lastDigit(vehicle.plate);
  if (digit === null) return { restricted: false };

  if (rule.restrictedDigits(date).has(digit)) {
    return {
      restricted: true,
      reason: `Pico y placa en ${rule.city}: placa terminada en ${digit} restringida`,
    };
  }
  return { restricted: false };
}
