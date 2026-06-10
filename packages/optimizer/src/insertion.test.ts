import { describe, expect, it } from "vitest";
import { insertOrderIntoRoute } from "./vrp.js";
import { matrixTravelModel, haversineTravelModel } from "./travel.js";
import type { OptimizableOrder, OptimizableVehicle } from "./types.js";

const DEPOT = { lat: 4.6486, lng: -74.0628 };

function order(
  id: string,
  lat: number,
  lng: number,
  extra: Partial<OptimizableOrder> = {},
): OptimizableOrder {
  return { id, location: { lat, lng }, weightKg: 2, priority: 0, ...extra };
}

function moto(): OptimizableVehicle {
  return { id: "m1", plate: "ABC12D", type: "MOTO", capacityKg: 15, isElectric: false };
}

describe("insertOrderIntoRoute (inserción dinámica / express)", () => {
  it("inserta en la posición de menor distancia total", () => {
    // Cola: norte (4.70) → sur (4.60). Nuevo pedido en el medio (4.65):
    // la mejor posición es ENTRE ambos, no al final.
    const pending = [order("n", 4.7, -74.06), order("s", 4.6, -74.06)];
    const result = insertOrderIntoRoute({
      pendingOrders: pending,
      newOrder: order("mid", 4.65, -74.06),
      vehicle: moto(),
      start: DEPOT,
      returnTo: DEPOT,
      departureMin: 8 * 60,
      rangeBudgetKm: Number.POSITIVE_INFINITY,
      currentLoadKg: 4,
    });

    expect(result).not.toBeNull();
    expect(result!.insertedAt).toBe(1); // entre n y s
    expect(result!.orders.map((o) => o.id)).toEqual(["n", "mid", "s"]);
    // ETAs crecientes y secuencia completa.
    const etas = result!.stops.map((s) => s.etaMin);
    expect([...etas].sort((a, b) => a - b)).toEqual(etas);
  });

  it("rechaza por capacidad (carga actual + nuevo pedido > capacidad)", () => {
    const result = insertOrderIntoRoute({
      pendingOrders: [order("a", 4.66, -74.05)],
      newOrder: order("heavy", 4.65, -74.06, { weightKg: 12 }),
      vehicle: moto(), // 15 kg
      start: DEPOT,
      returnTo: DEPOT,
      departureMin: 8 * 60,
      rangeBudgetKm: Number.POSITIVE_INFINITY,
      currentLoadKg: 10, // 10 + 12 > 15
    });
    expect(result).toBeNull();
  });

  it("rechaza cuando el presupuesto de autonomía restante no alcanza", () => {
    const result = insertOrderIntoRoute({
      pendingOrders: [order("a", 4.66, -74.05)],
      newOrder: order("far", 5.0, -74.4), // lejos
      vehicle: { ...moto(), isElectric: true },
      start: DEPOT,
      returnTo: DEPOT,
      departureMin: 8 * 60,
      rangeBudgetKm: 12, // muy poco
      currentLoadKg: 2,
    });
    expect(result).toBeNull();
  });

  it("mantiene el par pickup→delivery del pedido insertado adyacente", () => {
    const result = insertOrderIntoRoute({
      pendingOrders: [order("a", 4.66, -74.05), order("b", 4.63, -74.07)],
      newOrder: order("p", 4.65, -74.06, {
        pickupLocation: { lat: 4.64, lng: -74.065 },
      }),
      vehicle: moto(),
      start: DEPOT,
      returnTo: DEPOT,
      departureMin: 8 * 60,
      rangeBudgetKm: Number.POSITIVE_INFINITY,
      currentLoadKg: 4,
    });

    expect(result).not.toBeNull();
    const pStops = result!.stops
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.orderId === "p");
    expect(pStops.map(({ s }) => s.kind)).toEqual(["PICKUP", "DELIVERY"]);
    expect(pStops[1]!.i).toBe(pStops[0]!.i + 1);
  });

  it("respeta ventanas horarias de la cola al insertar", () => {
    // El pedido existente tiene ventana ajustada: insertar antes la rompería.
    const pending = [
      order("urgente", 4.66, -74.05, {
        timeWindow: { startMin: 8 * 60, endMin: 8 * 60 + 30 },
      }),
    ];
    const result = insertOrderIntoRoute({
      pendingOrders: pending,
      newOrder: order("lejos", 4.75, -74.1), // desvío largo
      vehicle: moto(),
      start: DEPOT,
      returnTo: DEPOT,
      departureMin: 8 * 60,
      rangeBudgetKm: Number.POSITIVE_INFINITY,
      currentLoadKg: 2,
    });

    // Solo es factible DESPUÉS del urgente (insertar antes viola su ventana).
    expect(result).not.toBeNull();
    expect(result!.orders.map((o) => o.id)).toEqual(["urgente", "lejos"]);
  });
});

describe("matrixTravelModel", () => {
  it("usa la matriz para puntos conocidos y haversine como fallback", () => {
    const a = { lat: 4.6, lng: -74.06 };
    const b = { lat: 4.7, lng: -74.06 };
    const unknown = { lat: 4.65, lng: -74.2 };
    const model = matrixTravelModel(
      [a, b],
      [
        [0, 99], // distancia "vial" artificial detectable
        [99, 0],
      ],
      [
        [0, 60],
        [60, 0],
      ],
    );

    expect(model.distanceKm(a, b)).toBe(99);
    // Moto: 60 min de carro × 0.8 = 48.
    expect(model.travelMin(a, b, "MOTO")).toBeCloseTo(48, 5);
    // Punto fuera de la matriz → fallback haversine (≈ valor real, no 99).
    const fallback = haversineTravelModel().distanceKm(a, unknown);
    expect(model.distanceKm(a, unknown)).toBeCloseTo(fallback, 6);
  });
});
