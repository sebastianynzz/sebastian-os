import {
  VEHICLE_TYPE_PROFILES,
  type TempProfile,
  type VehicleType,
} from "@moveos/shared";
import { capacityOk, reeferOk } from "./vrp.js";

/**
 * Empaque de carga (bin packing) por peso + volumen contra el catálogo EV
 * (`VEHICLE_TYPE_PROFILES`). Determinista, sin LLM. Respeta cadena de frío
 * (pedidos reefer solo en Cold Box compatible) y el flatbed (sin volumen,
 * limita por peso). Reparte para equilibrar la utilización. Es el solver de la
 * acción `optimize_load`.
 */

export interface PackOrder {
  id: string;
  weightKg: number;
  volumeM3?: number;
  tempProfile?: TempProfile;
}

export interface PackVehicle {
  id: string;
  type: VehicleType;
}

export interface PackAssignment {
  vehicleId: string;
  type: VehicleType;
  orderIds: string[];
  loadKg: number;
  loadM3: number;
  /** Utilización (0-100): máx. entre peso y volumen (flatbed: solo peso). */
  utilizationPct: number;
}

export interface PackResult {
  assignments: PackAssignment[];
  unassigned: { orderId: string; reason: string }[];
}

interface Bin {
  vehicle: PackVehicle;
  payloadKg: number;
  volumeM3: number | null;
  orderIds: string[];
  loadKg: number;
  loadM3: number;
}

function utilization(bin: Bin): number {
  const wPct = bin.payloadKg > 0 ? bin.loadKg / bin.payloadKg : 0;
  const vPct =
    bin.volumeM3 != null && bin.volumeM3 > 0 ? bin.loadM3 / bin.volumeM3 : 0;
  return Math.round(Math.max(wPct, vPct) * 100);
}

export function packLoad(
  orders: PackOrder[],
  vehicles: PackVehicle[],
): PackResult {
  const bins: Bin[] = vehicles.map((v) => {
    const p = VEHICLE_TYPE_PROFILES[v.type];
    return {
      vehicle: v,
      payloadKg: p.payloadKg,
      volumeM3: p.cargoVolumeM3,
      orderIds: [],
      loadKg: 0,
      loadM3: 0,
    };
  });

  // First-Fit-Decreasing por peso: los bultos grandes primero.
  const pending = orders
    .slice()
    .sort((a, b) => b.weightKg - a.weightKg);

  const unassigned: { orderId: string; reason: string }[] = [];

  for (const order of pending) {
    const m3 = order.volumeM3 ?? 0;

    // Candidatos: cumplen cadena de frío y capacidad tras añadir el pedido.
    const candidates = bins.filter(
      (bin) =>
        reeferOk(bin.vehicle.type, order.tempProfile) &&
        capacityOk(bin.vehicle.type, bin.loadKg + order.weightKg, bin.loadM3 + m3),
    );

    if (candidates.length === 0) {
      // Distingue el motivo: ¿incompatibilidad de frío o falta de capacidad?
      const anyReefer = bins.some((bin) =>
        reeferOk(bin.vehicle.type, order.tempProfile),
      );
      const reason =
        order.tempProfile && order.tempProfile !== "AMBIENT" && !anyReefer
          ? `Requiere cadena de frío ${order.tempProfile}; sin vehículo compatible`
          : "No cabe en ningún vehículo (capacidad excedida)";
      unassigned.push({ orderId: order.id, reason });
      continue;
    }

    // Equilibrar: asignar al candidato con MENOR utilización actual de peso.
    candidates.sort((a, b) => {
      const ua = a.payloadKg > 0 ? a.loadKg / a.payloadKg : 0;
      const ub = b.payloadKg > 0 ? b.loadKg / b.payloadKg : 0;
      return ua - ub;
    });
    const bin = candidates[0]!;
    bin.orderIds.push(order.id);
    bin.loadKg += order.weightKg;
    bin.loadM3 += m3;
  }

  const assignments: PackAssignment[] = bins
    .filter((b) => b.orderIds.length > 0)
    .map((b) => ({
      vehicleId: b.vehicle.id,
      type: b.vehicle.type,
      orderIds: b.orderIds,
      loadKg: Number(b.loadKg.toFixed(2)),
      loadM3: Number(b.loadM3.toFixed(3)),
      utilizationPct: utilization(b),
    }));

  return { assignments, unassigned };
}
