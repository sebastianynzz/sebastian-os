/**
 * Programación de turnos y oleadas (waves) de despacho. Determinista, sin LLM:
 * dado el volumen de pedidos del día y el roster de conductores, asigna
 * conductores a oleadas AM/PM para cubrir la demanda y reporta cobertura,
 * ociosidad y sobrecarga. Es el solver de `optimize_schedule`.
 */

export interface ScheduleDriver {
  id: string;
  name?: string;
}

export interface ScheduleWaveDef {
  label: string;
  dispatchHour: number; // hora de salida (0-23, hora Bogotá)
  cutoffHour: number; // corte de ingreso de pedidos a la oleada
  demandShare: number; // fracción de la demanda del día (suman ~1)
}

export interface ScheduleInput {
  totalOrders: number;
  drivers: ScheduleDriver[];
  /** Capacidad de pedidos por conductor por oleada. */
  ordersPerDriverPerWave?: number;
  waves?: ScheduleWaveDef[];
}

export interface WavePlan {
  label: string;
  dispatchHour: number;
  cutoffHour: number;
  demand: number;
  driversAssigned: number;
  capacity: number;
  coveragePct: number;
  overloaded: boolean;
}

export interface ScheduleResult {
  waves: WavePlan[];
  driversUsed: number;
  idleDrivers: number;
  coveragePct: number;
  notesEs: string[];
}

/** Oleadas por defecto: mañana (mayor demanda) y tarde. */
export const DEFAULT_WAVES: ScheduleWaveDef[] = [
  { label: "Oleada AM", dispatchHour: 8, cutoffHour: 11, demandShare: 0.6 },
  { label: "Oleada PM", dispatchHour: 13, cutoffHour: 16, demandShare: 0.4 },
];

const DEFAULT_PER_DRIVER = 18;

export function planSchedule(input: ScheduleInput): ScheduleResult {
  const perDriver = input.ordersPerDriverPerWave ?? DEFAULT_PER_DRIVER;
  const defs = input.waves ?? DEFAULT_WAVES;
  const available = input.drivers.length;
  const total = input.totalOrders;

  const base = defs.map((def) => {
    const demand = Math.round(total * def.demandShare);
    const need = Math.ceil(demand / perDriver);
    return { def, demand, need };
  });
  const totalNeed = base.reduce((a, w) => a + w.need, 0);

  // Asignación: cubrir lo necesario si hay conductores suficientes; si no,
  // repartir proporcional a la necesidad y marcar oleadas sobrecargadas.
  let assigned: number[];
  if (totalNeed <= available) {
    assigned = base.map((w) => w.need);
  } else if (available === 0 || totalNeed === 0) {
    assigned = base.map(() => 0);
  } else {
    assigned = base.map((w) => Math.floor((available * w.need) / totalNeed));
    let used = assigned.reduce((a, b) => a + b, 0);
    // Reparte el remanente a las oleadas de mayor demanda (orden estable).
    const order = base
      .map((w, idx) => ({ idx, demand: w.demand }))
      .sort((a, b) => b.demand - a.demand || a.idx - b.idx)
      .map((x) => x.idx);
    let i = 0;
    while (used < available && order.length > 0) {
      const idx = order[i % order.length]!;
      assigned[idx] = (assigned[idx] ?? 0) + 1;
      used++;
      i++;
    }
  }

  const waves: WavePlan[] = base.map((w, idx) => {
    const driversAssigned = assigned[idx]!;
    const capacity = driversAssigned * perDriver;
    const coveragePct =
      w.demand === 0 ? 100 : Math.min(100, Math.round((capacity / w.demand) * 100));
    return {
      label: w.def.label,
      dispatchHour: w.def.dispatchHour,
      cutoffHour: w.def.cutoffHour,
      demand: w.demand,
      driversAssigned,
      capacity,
      coveragePct,
      overloaded: capacity < w.demand,
    };
  });

  const driversUsed = assigned.reduce((a, b) => a + b, 0);
  const totalCapacity = waves.reduce((a, w) => a + w.capacity, 0);
  const coveragePct =
    total === 0 ? 100 : Math.min(100, Math.round((totalCapacity / total) * 100));

  const notesEs: string[] = [
    `${total} pedido(s) en ${waves.length} oleada(s); ${driversUsed}/${available} conductor(es) asignados`,
  ];
  const over = waves.filter((w) => w.overloaded);
  if (over.length) notesEs.push(`Sobrecarga en: ${over.map((w) => w.label).join(", ")}`);
  if (available - driversUsed > 0) notesEs.push(`${available - driversUsed} conductor(es) sin asignar`);

  return {
    waves,
    driversUsed,
    idleDrivers: available - driversUsed,
    coveragePct,
    notesEs,
  };
}
