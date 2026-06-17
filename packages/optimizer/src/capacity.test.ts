import { describe, expect, it } from "vitest";
import { planCapacity } from "./capacity.js";

describe("planCapacity (capacidad de flota, asesor)", () => {
  it("mapea el pronóstico a configuraciones (frío → Cold Box, seco → IONAx)", () => {
    const res = planCapacity({
      forecastOrders: 100,
      coldChainOrders: 40,
      frozenOrders: 10,
      ordersPerVehicle: 20,
      currentFleet: {},
    });
    // frozen 10 → ceil(10/20)=1 RAP_MOVE_COLD_BOX
    expect(res.recommended.RAP_MOVE_COLD_BOX).toBe(1);
    // chilled 30 → ceil(30/20)=2 IONAX_COLD_BOX
    expect(res.recommended.IONAX_COLD_BOX).toBe(2);
    // seco 60 → ceil(60/20)=3 IONAX
    expect(res.recommended.IONAX).toBe(3);
  });

  it("recomienda flatbed para carga sobredimensionada", () => {
    const res = planCapacity({
      forecastOrders: 40,
      oversizedOrders: 20,
      ordersPerVehicle: 20,
      currentFleet: {},
    });
    expect(res.recommended.IONAX_PICKUP).toBe(1);
  });

  it("calcula brechas frente a la flota actual", () => {
    const res = planCapacity({
      forecastOrders: 60,
      ordersPerVehicle: 20,
      currentFleet: { IONAX: 1 },
    });
    // necesita 3 IONAx, tiene 1 → faltan 2.
    const gap = res.gaps.find((g) => g.type === "IONAX")!;
    expect(gap.delta).toBe(2);
  });

  it("marca excedentes cuando la flota supera la necesidad", () => {
    const res = planCapacity({
      forecastOrders: 20,
      ordersPerVehicle: 20,
      currentFleet: { IONAX: 5 },
    });
    const gap = res.gaps.find((g) => g.type === "IONAX")!;
    expect(gap.delta).toBeLessThan(0); // sobran
  });

  it("calcula conductores necesarios (1 por vehículo por defecto)", () => {
    const res = planCapacity({ forecastOrders: 60, ordersPerVehicle: 20, currentFleet: {} });
    expect(res.driversNeeded).toBe(3);
  });
});
