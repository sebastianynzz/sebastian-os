import { describe, expect, it } from "vitest";
import { rankVehicleConfigs } from "./vehiclePick.js";

describe("rankVehicleConfigs (elección de vehículo óptimo)", () => {
  it("FROZEN: solo la Cold Box congeladora es apta y queda primera", () => {
    const ranked = rankVehicleConfigs({ totalKg: 30, totalM3: 0.3, coldChain: "FROZEN", distanceKm: 40 });
    expect(ranked[0]!.type).toBe("RAP_MOVE_COLD_BOX");
    expect(ranked[0]!.feasible).toBe(true);
    const feasibleTypes = ranked.filter((r) => r.feasible).map((r) => r.type);
    expect(feasibleTypes).toEqual(["RAP_MOVE_COLD_BOX"]);
  });

  it("CHILLED: el tope es una Cold Box; las configuraciones secas no son aptas", () => {
    const ranked = rankVehicleConfigs({ totalKg: 50, totalM3: 0.5, coldChain: "CHILLED", distanceKm: 40 });
    expect(["RAP_MOVE_COLD_BOX", "IONAX_COLD_BOX"]).toContain(ranked[0]!.type);
    const dry = ranked.find((r) => r.type === "IONAX")!;
    expect(dry.feasible).toBe(false);
  });

  it("carga ligera seca: prefiere la Rap Move Light", () => {
    const ranked = rankVehicleConfigs({ totalKg: 10, totalM3: 0.2, distanceKm: 50 });
    expect(ranked[0]!.type).toBe("RAP_MOVE_LIGHT");
  });

  it("carga pesada con volumen: las Rap Move no caben; gana una IONAx cerrada", () => {
    const ranked = rankVehicleConfigs({ totalKg: 400, totalM3: 2.5, distanceKm: 60 });
    expect(ranked[0]!.type).toBe("IONAX");
    for (const t of ["RAP_MOVE_LIGHT", "RAP_MOVE_XL", "RAP_MOVE_COLD_BOX"]) {
      expect(ranked.find((r) => r.type === t)!.feasible).toBe(false);
    }
  });

  it("carga sobredimensionada: gana el flatbed (Pick Up)", () => {
    const ranked = rankVehicleConfigs({ totalKg: 300, oversized: true, distanceKm: 50 });
    expect(ranked[0]!.type).toBe("IONAX_PICKUP");
  });

  it("ruta larga: solo las IONAx (pack grande) cubren la autonomía", () => {
    const ranked = rankVehicleConfigs({ totalKg: 20, distanceKm: 200 });
    expect(ranked[0]!.feasible).toBe(true);
    for (const t of ["RAP_MOVE_LIGHT", "RAP_MOVE_XL", "RAP_MOVE_COLD_BOX"]) {
      expect(ranked.find((r) => r.type === t)!.feasible).toBe(false);
    }
    expect(ranked[0]!.requiredBatteryKwh).toBe(23.04); // pack grande necesario
  });
});
