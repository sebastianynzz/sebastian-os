import { describe, expect, it } from "vitest";
import { VEHICLE_TYPES, type VehicleType } from "@moveos/shared";
import { capacityOk, reeferOk, planRoutes } from "./vrp.js";
import {
  estimateUsableRangeKm,
  resolveNominalRangeKm,
  reeferEnergyKwh,
} from "./evRange.js";
import { checkPicoYPlaca } from "./picoYPlaca.js";
import type { OptimizableOrder, OptimizableVehicle } from "./types.js";

const DEPOT = { lat: 4.6486, lng: -74.0628 };
const ODD_DAY = new Date(2026, 5, 11, 8, 0, 0);
const EVEN_DAY = new Date(2026, 5, 10, 9, 0, 0);

describe("capacidad por configuración (capacityOk, lee el catálogo)", () => {
  it("acepta ≤ payload/volumen y rechaza por encima", () => {
    // RAP_MOVE_LIGHT: 115 kg / 0.5 m³
    expect(capacityOk("RAP_MOVE_LIGHT", 115, 0.5)).toBe(true);
    expect(capacityOk("RAP_MOVE_LIGHT", 116, 0.5)).toBe(false); // peso
    expect(capacityOk("RAP_MOVE_LIGHT", 100, 0.6)).toBe(false); // volumen
    // IONAX: 530 kg / 3.0 m³
    expect(capacityOk("IONAX", 530, 3.0)).toBe(true);
    expect(capacityOk("IONAX", 530, 3.1)).toBe(false);
  });

  it("el flatbed (IONAX_PICKUP) ignora el volumen y limita por peso", () => {
    expect(capacityOk("IONAX_PICKUP", 530, 99)).toBe(true); // volumen irrelevante
    expect(capacityOk("IONAX_PICKUP", 531, 0)).toBe(false); // peso excedido
  });
});

describe("emparejamiento de cadena de frío (reeferOk)", () => {
  it("FROZEN solo es factible en RAP_MOVE_COLD_BOX", () => {
    for (const t of VEHICLE_TYPES) {
      expect(reeferOk(t, "FROZEN")).toBe(t === "RAP_MOVE_COLD_BOX");
    }
  });

  it("CHILLED es factible en ambas Cold Box y en ninguna más", () => {
    const chilled = VEHICLE_TYPES.filter((t) => reeferOk(t, "CHILLED"));
    expect(chilled.sort()).toEqual(["IONAX_COLD_BOX", "RAP_MOVE_COLD_BOX"]);
  });

  it("AMBIENT es factible en las 6 configuraciones", () => {
    for (const t of VEHICLE_TYPES) {
      expect(reeferOk(t, "AMBIENT")).toBe(true);
      expect(reeferOk(t, undefined)).toBe(true);
    }
  });

  it("ningún pedido refrigerado es factible en el flatbed", () => {
    expect(reeferOk("IONAX_PICKUP", "CHILLED")).toBe(false);
    expect(reeferOk("IONAX_PICKUP", "FROZEN")).toBe(false);
  });
});

describe("autonomía por pack instalado (resolveNominalRangeKm)", () => {
  it("IONAx: 11.52 kWh → 130 km, 23.04 kWh → 260 km", () => {
    expect(resolveNominalRangeKm({ type: "IONAX", batteryKwh: 11.52 })).toBe(130);
    expect(resolveNominalRangeKm({ type: "IONAX", batteryKwh: 23.04 })).toBe(260);
  });

  it("sin pack o pack desconocido cae al más conservador (el menor)", () => {
    expect(resolveNominalRangeKm({ type: "IONAX" })).toBe(130);
    expect(resolveNominalRangeKm({ type: "IONAX", batteryKwh: 99 })).toBe(130);
  });

  it("override explícito de nominalRangeKm tiene prioridad", () => {
    expect(
      resolveNominalRangeKm({ type: "IONAX", batteryKwh: 11.52, nominalRangeKm: 200 }),
    ).toBe(200);
  });

  it("configuraciones Rap Move devuelven su valor único", () => {
    expect(resolveNominalRangeKm({ type: "RAP_MOVE_LIGHT" })).toBe(100);
    expect(resolveNominalRangeKm({ type: "RAP_MOVE_XL" })).toBe(120);
    expect(resolveNominalRangeKm({ type: "RAP_MOVE_COLD_BOX" })).toBe(90);
  });
});

describe("sin doble descuento (autonomía reefer-on)", () => {
  it("la autonomía útil de una Cold Box es la deración de su rango publicado", () => {
    const nominal = resolveNominalRangeKm({ type: "RAP_MOVE_COLD_BOX" }); // 90, reefer-on
    const usable = estimateUsableRangeKm({ nominalRangeKm: nominal, socPercent: 100 });
    // 90 × 1 (21°C, sin carga) × 1.0 SoC × (1 - 0.15 margen) = 76.5. Sin restar
    // consumo de refrigeración (ya está incluido en el rango publicado).
    expect(usable).toBeCloseTo(90 * 0.85, 5);
  });

  it("reeferEnergyKwh es analítica aparte (no penaliza el rango)", () => {
    expect(reeferEnergyKwh("RAP_MOVE_COLD_BOX", 1)).toBeCloseTo((0.45 + 0.65) / 2, 5);
    expect(reeferEnergyKwh("IONAX_COLD_BOX", 2)).toBeCloseTo(0.7 * 2, 5);
    expect(reeferEnergyKwh("IONAX", 5)).toBe(0); // sin reefer
  });
});

describe("pico y placa: las 6 configuraciones son exentas (Ley 1964/2019)", () => {
  it("ninguna configuración EV queda restringida, incluso en día/placa restringidos", () => {
    for (const t of VEHICLE_TYPES) {
      const check = checkPicoYPlaca(
        { plate: "JDK458", type: t, isElectric: true },
        "Bogotá",
        EVEN_DAY,
        9 * 60,
      );
      expect(check.restricted).toBe(false);
      expect(check.reason).toMatch(/Exento/);
    }
  });

  it("exenta por el catálogo aun si la bandera isElectric viniera en false", () => {
    const check = checkPicoYPlaca(
      { plate: "JDK458", type: "IONAX", isElectric: false },
      "Bogotá",
      EVEN_DAY,
      9 * 60,
    );
    expect(check.restricted).toBe(false);
  });
});

describe("planRoutes: ruteo de cadena de frío con razones en español", () => {
  function vehicle(
    id: string,
    type: VehicleType,
    plate: string,
  ): OptimizableVehicle {
    return { id, plate, type, capacityKg: 500, capacityM3: 3, isElectric: true };
  }
  function order(
    id: string,
    tempProfile: OptimizableOrder["tempProfile"],
  ): OptimizableOrder {
    return {
      id,
      location: { lat: 4.66, lng: -74.05 },
      weightKg: 5,
      tempProfile,
      priority: 0,
    };
  }

  it("asigna un pedido FROZEN a la Cold Box congeladora", () => {
    const result = planRoutes({
      date: ODD_DAY,
      city: "Bogotá",
      depot: DEPOT,
      orders: [order("f1", "FROZEN")],
      vehicles: [vehicle("v1", "RAP_MOVE_COLD_BOX", "FRZ001")],
    });
    expect(result.unassigned).toHaveLength(0);
    expect(result.routes).toHaveLength(1);
  });

  it("rechaza FROZEN en un vehículo no refrigerado con razón clara", () => {
    const result = planRoutes({
      date: ODD_DAY,
      city: "Bogotá",
      depot: DEPOT,
      orders: [order("f1", "FROZEN")],
      vehicles: [vehicle("v1", "IONAX", "DRY001")],
    });
    expect(result.routes).toHaveLength(0);
    expect(result.unassigned).toHaveLength(1);
    expect(result.unassigned[0]!.reason).toMatch(
      /cadena de frío FROZEN; vehículo no refrigerado/,
    );
  });

  it("rechaza FROZEN en la Cold Box que solo enfría (CHILLED) con razón clara", () => {
    const result = planRoutes({
      date: ODD_DAY,
      city: "Bogotá",
      depot: DEPOT,
      orders: [order("f1", "FROZEN")],
      vehicles: [vehicle("v1", "IONAX_COLD_BOX", "CHL001")],
    });
    expect(result.unassigned).toHaveLength(1);
    expect(result.unassigned[0]!.reason).toMatch(/no soporta FROZEN/);
  });

  it("un pedido AMBIENT es factible en cualquier configuración", () => {
    for (const t of VEHICLE_TYPES) {
      const result = planRoutes({
        date: ODD_DAY,
        city: "Bogotá",
        depot: DEPOT,
        orders: [order("a1", "AMBIENT")],
        vehicles: [vehicle("v1", t, "AMB001")],
      });
      expect(result.unassigned).toHaveLength(0);
    }
  });
});
