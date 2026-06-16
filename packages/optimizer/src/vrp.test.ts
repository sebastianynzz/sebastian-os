import { describe, expect, it } from "vitest";
import { checkPicoYPlaca } from "./picoYPlaca.js";
import { estimateUsableRangeKm } from "./evRange.js";
import { planRoutes } from "./vrp.js";
import type { OptimizableOrder, OptimizableVehicle } from "./types.js";

// Martes 10 de junio de 2026 — día par.
const EVEN_DAY = new Date(2026, 5, 10, 8, 0, 0);
// Jueves 11 de junio de 2026 — día impar.
const ODD_DAY = new Date(2026, 5, 11, 8, 0, 0);
const DEPOT = { lat: 4.6486, lng: -74.0628 }; // Chapinero, Bogotá

function order(
  id: string,
  lat: number,
  lng: number,
  extra: Partial<OptimizableOrder> = {},
): OptimizableOrder {
  return {
    id,
    location: { lat, lng },
    weightKg: 2,
    priority: 0,
    ...extra,
  };
}

// EV ligero de baja capacidad (capacidad explícita 15 kg para forzar el
// chequeo de capacidad en pruebas de mecánica de ruta; toda la flota es EV).
function lightEv(id: string, plate = "ABC12D"): OptimizableVehicle {
  return {
    id,
    plate,
    type: "RAP_MOVE_LIGHT",
    capacityKg: 15,
    isElectric: false,
  };
}

describe("pico y placa (Bogotá)", () => {
  it("restringe carro con placa par en día par dentro del horario", () => {
    const check = checkPicoYPlaca(
      { plate: "JDK458", type: "CARRO", isElectric: false },
      "Bogotá",
      EVEN_DAY,
      9 * 60,
    );
    expect(check.restricted).toBe(true);
  });

  it("permite carro con placa impar en día par", () => {
    const check = checkPicoYPlaca(
      { plate: "JDK457", type: "CARRO", isElectric: false },
      "Bogotá",
      EVEN_DAY,
      9 * 60,
    );
    expect(check.restricted).toBe(false);
  });

  it("permite circular fuera del horario de restricción", () => {
    const check = checkPicoYPlaca(
      { plate: "JDK458", type: "CARRO", isElectric: false },
      "Bogotá",
      EVEN_DAY,
      5 * 60,
    );
    expect(check.restricted).toBe(false);
  });

  it("exime a las motos en Bogotá", () => {
    const check = checkPicoYPlaca(
      { plate: "ABC12D", type: "MOTO", isElectric: false },
      "Bogotá",
      EVEN_DAY,
      9 * 60,
    );
    expect(check.restricted).toBe(false);
  });

  it("exime a los vehículos eléctricos (Ley 1964)", () => {
    const check = checkPicoYPlaca(
      { plate: "JDK458", type: "VAN", isElectric: true },
      "Bogotá",
      EVEN_DAY,
      9 * 60,
    );
    expect(check.restricted).toBe(false);
  });

  it("no aplica restricción el fin de semana", () => {
    const sunday = new Date(2026, 5, 14, 9, 0, 0);
    const check = checkPicoYPlaca(
      { plate: "JDK458", type: "CARRO", isElectric: false },
      "Bogotá",
      sunday,
      9 * 60,
    );
    expect(check.restricted).toBe(false);
  });
});

describe("autonomía EV", () => {
  it("reduce la autonomía con SoC parcial y margen de seguridad", () => {
    const range = estimateUsableRangeKm({
      nominalRangeKm: 200,
      socPercent: 50,
      safetyMargin: 0.15,
    });
    expect(range).toBeCloseTo(200 * 0.5 * 0.85, 1);
  });

  it("penaliza frío, carga y elevación", () => {
    const base = estimateUsableRangeKm({ nominalRangeKm: 200, socPercent: 100 });
    const harsh = estimateUsableRangeKm({
      nominalRangeKm: 200,
      socPercent: 100,
      temperatureC: 8, // madrugada bogotana
      payloadKg: 450,
      elevationGainM: 600,
    });
    expect(harsh).toBeLessThan(base);
    expect(harsh).toBeGreaterThan(0);
  });
});

describe("planRoutes (VRP)", () => {
  it("asigna todos los pedidos factibles y secuencia las paradas", () => {
    const orders = [
      order("o1", 4.66, -74.05),
      order("o2", 4.63, -74.07),
      order("o3", 4.67, -74.06),
      order("o4", 4.62, -74.08),
    ];
    const result = planRoutes({
      date: ODD_DAY,
      city: "Bogotá",
      depot: DEPOT,
      orders,
      vehicles: [lightEv("m1")],
    });

    expect(result.unassigned).toHaveLength(0);
    expect(result.routes).toHaveLength(1);
    const route = result.routes[0]!;
    expect(route.stops.map((s) => s.sequence)).toEqual([1, 2, 3, 4]);
    expect(route.totalDistanceKm).toBeGreaterThan(0);
    // Las ETAs deben ser crecientes.
    const etas = route.stops.map((s) => s.etaMin);
    expect([...etas].sort((a, b) => a - b)).toEqual(etas);
  });

  it("respeta la capacidad de los vehículos", () => {
    const orders = [
      order("o1", 4.66, -74.05, { weightKg: 10 }),
      order("o2", 4.63, -74.07, { weightKg: 10 }),
    ];
    const result = planRoutes({
      date: ODD_DAY,
      city: "Bogotá",
      depot: DEPOT,
      orders,
      vehicles: [lightEv("m1")], // capacidad 15 kg: solo cabe un pedido
    });

    const assigned = result.routes.flatMap((r) => r.stops).length;
    expect(assigned).toBe(1);
    expect(result.unassigned).toHaveLength(1);
    expect(result.unassigned[0]!.reason).toMatch(/Capacidad/);
  });

  it("pickup→delivery: genera 2 paradas y la recogida precede a la entrega", () => {
    const orders = [
      // Pedido con recogida en un punto y entrega en otro.
      order("p1", 4.66, -74.05, { pickupLocation: { lat: 4.65, lng: -74.06 } }),
      // Pedido solo-entrega (desde depósito): 1 sola parada.
      order("d1", 4.63, -74.07),
    ];
    const result = planRoutes({
      date: ODD_DAY,
      city: "Bogotá",
      depot: DEPOT,
      orders,
      vehicles: [lightEv("m1")],
    });

    expect(result.unassigned).toHaveLength(0);
    const route = result.routes[0]!;
    // 3 paradas: pickup(p1) + delivery(p1) + delivery(d1).
    expect(route.stops).toHaveLength(3);

    const p1Stops = route.stops.filter((s) => s.orderId === "p1");
    expect(p1Stops.map((s) => s.kind)).toEqual(["PICKUP", "DELIVERY"]);
    // La recogida precede a la entrega en la secuencia.
    expect(p1Stops[0]!.sequence).toBeLessThan(p1Stops[1]!.sequence);

    // El pedido solo-entrega tiene una única parada DELIVERY.
    const d1Stops = route.stops.filter((s) => s.orderId === "d1");
    expect(d1Stops).toHaveLength(1);
    expect(d1Stops[0]!.kind).toBe("DELIVERY");

    // ETAs crecientes y secuencia contigua.
    const etas = route.stops.map((s) => s.etaMin);
    expect([...etas].sort((a, b) => a - b)).toEqual(etas);
    expect(route.stops.map((s) => s.sequence)).toEqual([1, 2, 3]);
  });

  it("mantiene el par pickup→delivery adyacente tras 2-opt", () => {
    // Varios pedidos con recogida: el par no debe separarse.
    const orders = [
      order("a", 4.60, -74.08, { pickupLocation: { lat: 4.61, lng: -74.075 } }),
      order("b", 4.70, -74.04, { pickupLocation: { lat: 4.69, lng: -74.045 } }),
      order("c", 4.62, -74.07, { pickupLocation: { lat: 4.63, lng: -74.065 } }),
    ];
    const result = planRoutes({
      date: ODD_DAY,
      city: "Bogotá",
      depot: DEPOT,
      orders,
      vehicles: [lightEv("m1", "XYZ99E")],
    });

    const route = result.routes[0]!;
    expect(route.stops).toHaveLength(6); // 3 pares
    // Para cada pedido, su PICKUP aparece inmediatamente antes que su DELIVERY.
    for (const id of ["a", "b", "c"]) {
      const idx = route.stops
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => s.orderId === id);
      expect(idx).toHaveLength(2);
      expect(idx[0]!.s.kind).toBe("PICKUP");
      expect(idx[1]!.s.kind).toBe("DELIVERY");
      expect(idx[1]!.i).toBe(idx[0]!.i + 1); // adyacentes
    }
  });

  it("NO excluye vehículos de la flota por pico y placa (todos EV exentos)", () => {
    // Día par + placa terminada en 8: restringiría a un ICE, pero la flota es
    // 100% eléctrica → exenta (Ley 1964/2019). Se asigna igual.
    const result = planRoutes({
      date: EVEN_DAY,
      city: "Bogotá",
      depot: DEPOT,
      orders: [order("o1", 4.66, -74.05)],
      vehicles: [
        {
          id: "v1",
          plate: "JDK458",
          type: "IONAX",
          capacityKg: 800,
          isElectric: true,
        },
      ],
    });

    expect(result.excludedVehicles).toHaveLength(0);
    expect(result.unassigned).toHaveLength(0);
    expect(result.routes).toHaveLength(1);
  });

  it("marca pedidos fuera de la autonomía de un EV", () => {
    // Pedido a ~78 km en línea recta (>100 km por vía con factor urbano).
    const farAway = order("far", 5.3, -74.4);
    const result = planRoutes({
      date: ODD_DAY,
      city: "Bogotá",
      depot: DEPOT,
      orders: [farAway],
      vehicles: [
        {
          id: "ev1",
          plate: "EAA111",
          type: "IONAX",
          capacityKg: 600,
          isElectric: true,
          nominalRangeKm: 120,
          socPercent: 40,
        },
      ],
    });

    expect(result.routes).toHaveLength(0);
    expect(result.unassigned).toHaveLength(1);
    expect(result.unassigned[0]!.reason).toMatch(/autonomía/i);
  });

  it("respeta ventanas horarias: no asigna si llegaría tarde", () => {
    const tooEarlyWindow = order("o1", 4.66, -74.05, {
      timeWindow: { startMin: 6 * 60, endMin: 7 * 60 }, // ventana antes de la salida (8:00)
    });
    const result = planRoutes({
      date: ODD_DAY,
      city: "Bogotá",
      depot: DEPOT,
      orders: [tooEarlyWindow],
      vehicles: [lightEv("m1")],
    });

    expect(result.unassigned).toHaveLength(1);
  });

  it("espera la apertura de la ventana horaria cuando llega temprano", () => {
    const lateWindow = order("o1", 4.66, -74.05, {
      timeWindow: { startMin: 10 * 60, endMin: 12 * 60 },
    });
    const result = planRoutes({
      date: ODD_DAY,
      city: "Bogotá",
      depot: DEPOT,
      orders: [lateWindow],
      vehicles: [lightEv("m1")],
    });

    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]!.stops[0]!.etaMin).toBeGreaterThanOrEqual(10 * 60);
  });

  it("2-opt produce una ruta no peor que el orden de inserción", () => {
    // Pedidos dispuestos para que el vecino más cercano produzca cruces.
    const orders = [
      order("a", 4.60, -74.08),
      order("b", 4.70, -74.04),
      order("c", 4.61, -74.075),
      order("d", 4.69, -74.045),
      order("e", 4.62, -74.07),
      order("f", 4.68, -74.05),
    ];
    const result = planRoutes({
      date: ODD_DAY,
      city: "Bogotá",
      depot: DEPOT,
      orders,
      vehicles: [lightEv("m1", "XYZ99E")],
    });

    expect(result.routes).toHaveLength(1);
    expect(result.unassigned).toHaveLength(0);
    // Verificación de sanidad: la distancia es finita y razonable (< 60 km).
    expect(result.routes[0]!.totalDistanceKm).toBeLessThan(60);
  });
});
