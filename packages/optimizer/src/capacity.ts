import { VEHICLE_TYPES, type VehicleType } from "@moveos/shared";

/**
 * Planeación de capacidad de flota (asesor, no muta). Determinista, sin LLM:
 * dado un pronóstico de demanda (con su parte de cadena de frío) y la flota
 * actual por configuración, recomienda cuántos vehículos de cada una de las 6
 * configuraciones y cuántos conductores desplegar, y los compara con lo
 * existente (brechas/excedentes). Es el solver de `plan_capacity`.
 */

export interface CapacityInput {
  forecastOrders: number;
  /** Pedidos refrigerados (chilled + frozen) del pronóstico. */
  coldChainOrders?: number;
  /** Subconjunto congelado (requiere RAP_MOVE_COLD_BOX). */
  frozenOrders?: number;
  /** Pedidos sobredimensionados (requieren flatbed). */
  oversizedOrders?: number;
  ordersPerVehicle?: number;
  driversPerVehicle?: number;
  currentFleet: Partial<Record<VehicleType, number>>;
}

export interface CapacityGap {
  type: VehicleType;
  have: number;
  recommended: number;
  delta: number; // recommended - have (positivo = faltan; negativo = sobran)
}

export interface CapacityResult {
  recommended: Record<VehicleType, number>;
  gaps: CapacityGap[];
  driversNeeded: number;
  notesEs: string[];
}

const DEFAULT_PER_VEHICLE = 20;

function zeroFleet(): Record<VehicleType, number> {
  return VEHICLE_TYPES.reduce(
    (acc, t) => ((acc[t] = 0), acc),
    {} as Record<VehicleType, number>,
  );
}

export function planCapacity(input: CapacityInput): CapacityResult {
  const perVehicle = input.ordersPerVehicle ?? DEFAULT_PER_VEHICLE;
  const driversPerVehicle = input.driversPerVehicle ?? 1;

  const frozen = Math.max(0, input.frozenOrders ?? 0);
  const cold = Math.max(frozen, input.coldChainOrders ?? 0); // cold incluye frozen
  const chilled = cold - frozen;
  const oversized = Math.max(0, input.oversizedOrders ?? 0);
  const dry = Math.max(0, input.forecastOrders - cold - oversized);

  const recommended = zeroFleet();
  recommended.RAP_MOVE_COLD_BOX = Math.ceil(frozen / perVehicle);
  recommended.IONAX_COLD_BOX = Math.ceil(chilled / perVehicle);
  recommended.IONAX_PICKUP = Math.ceil(oversized / perVehicle);
  // Carga seca a la van utilitaria (IONAx) por defecto.
  recommended.IONAX = recommended.IONAX + Math.ceil(dry / perVehicle);

  const gaps: CapacityGap[] = VEHICLE_TYPES.map((type) => {
    const have = input.currentFleet[type] ?? 0;
    const rec = recommended[type];
    return { type, have, recommended: rec, delta: rec - have };
  });

  const totalVehicles = VEHICLE_TYPES.reduce((a, t) => a + recommended[t], 0);
  const driversNeeded = totalVehicles * driversPerVehicle;

  const shortfalls = gaps.filter((g) => g.delta > 0);
  const surplus = gaps.filter((g) => g.delta < 0);
  const notesEs = [
    `Pronóstico ${input.forecastOrders} pedido(s) → ${totalVehicles} vehículo(s), ${driversNeeded} conductor(es)`,
  ];
  if (shortfalls.length)
    notesEs.push(
      `Faltan: ${shortfalls.map((g) => `${g.delta} ${g.type}`).join(", ")}`,
    );
  if (surplus.length)
    notesEs.push(
      `Sobran: ${surplus.map((g) => `${-g.delta} ${g.type}`).join(", ")}`,
    );

  return { recommended, gaps, driversNeeded, notesEs };
}
