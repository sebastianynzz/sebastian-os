import { describe, expect, it } from "vitest";
import { packLoad, type PackOrder, type PackVehicle } from "./loadPacking.js";

const ambient = (id: string, weightKg: number, volumeM3?: number): PackOrder => ({
  id,
  weightKg,
  volumeM3,
});

describe("packLoad (bin packing por peso + volumen)", () => {
  it("asigna respetando el payload del catálogo", () => {
    const vehicles: PackVehicle[] = [{ id: "v1", type: "RAP_MOVE_LIGHT" }]; // 115 kg
    const res = packLoad(
      [ambient("a", 100), ambient("b", 100)], // 200 > 115: solo cabe uno
      vehicles,
    );
    expect(res.assignments).toHaveLength(1);
    expect(res.assignments[0]!.orderIds).toHaveLength(1);
    expect(res.unassigned).toHaveLength(1);
    expect(res.unassigned[0]!.reason).toMatch(/capacidad/i);
  });

  it("un pedido FROZEN solo cabe en una Cold Box congeladora", () => {
    const onlyDry: PackVehicle[] = [{ id: "v1", type: "IONAX" }];
    const dryRes = packLoad([{ id: "f", weightKg: 5, tempProfile: "FROZEN" }], onlyDry);
    expect(dryRes.assignments).toHaveLength(0);
    expect(dryRes.unassigned[0]!.reason).toMatch(/cadena de frío FROZEN/);

    const withFreezer: PackVehicle[] = [
      { id: "v1", type: "IONAX" },
      { id: "v2", type: "RAP_MOVE_COLD_BOX" },
    ];
    const ok = packLoad([{ id: "f", weightKg: 5, tempProfile: "FROZEN" }], withFreezer);
    expect(ok.assignments).toHaveLength(1);
    expect(ok.assignments[0]!.type).toBe("RAP_MOVE_COLD_BOX");
  });

  it("CHILLED entra en una Cold Box (no en seco)", () => {
    const vehicles: PackVehicle[] = [
      { id: "v1", type: "IONAX" },
      { id: "v2", type: "IONAX_COLD_BOX" },
    ];
    const res = packLoad([{ id: "c", weightKg: 20, tempProfile: "CHILLED" }], vehicles);
    expect(res.assignments[0]!.type).toBe("IONAX_COLD_BOX");
  });

  it("el flatbed ignora el volumen (limita por peso)", () => {
    const vehicles: PackVehicle[] = [{ id: "v1", type: "IONAX_PICKUP" }]; // 530 kg, sin volumen
    const res = packLoad([ambient("a", 500, 99)], vehicles); // volumen enorme, peso ok
    expect(res.assignments).toHaveLength(1);
    expect(res.unassigned).toHaveLength(0);
  });

  it("equilibra la carga entre vehículos y reporta utilización", () => {
    const vehicles: PackVehicle[] = [
      { id: "v1", type: "IONAX" }, // 530 kg
      { id: "v2", type: "IONAX" }, // 530 kg
    ];
    const res = packLoad(
      [ambient("a", 200), ambient("b", 200), ambient("c", 200)],
      vehicles,
    );
    // 3 pedidos de 200 kg en 2 vehículos: se reparten (2 + 1).
    expect(res.unassigned).toHaveLength(0);
    const counts = res.assignments.map((a) => a.orderIds.length).sort();
    expect(counts).toEqual([1, 2]);
    for (const a of res.assignments) {
      expect(a.utilizationPct).toBeGreaterThan(0);
      expect(a.utilizationPct).toBeLessThanOrEqual(100);
    }
  });
});
