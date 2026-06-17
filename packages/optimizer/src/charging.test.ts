import { describe, expect, it } from "vitest";
import { planCharging, DEFAULT_TARIFF, type ChargeVehicleInput } from "./charging.js";

const v = (over: Partial<ChargeVehicleInput> = {}): ChargeVehicleInput => ({
  id: "v1",
  type: "IONAX",
  batteryKwh: 11.52,
  socPercent: 50,
  energyNeedKwh: 6,
  ...over,
});

describe("planCharging (programación de carga por tarifa horaria)", () => {
  it("elige la ventana más barata (valle nocturno)", () => {
    const res = planCharging([v()]);
    expect(res.plans[0]!.window).toBe("Valle (noche)");
    expect(res.plans[0]!.copPerKwh).toBe(480);
  });

  it("calcula la energía a cargar y el costo estimado", () => {
    // SoC 50% de 11.52 = 5.76 kWh; objetivo = 6×1.15 = 6.9 kWh → cargar 1.14.
    const res = planCharging([v({ socPercent: 50, energyNeedKwh: 6 })]);
    const p = res.plans[0]!;
    expect(p.energyKwh).toBeCloseTo(1.14, 1);
    expect(p.estCostCop).toBe(Math.round(p.energyKwh * 480));
    expect(p.ready).toBe(true);
  });

  it("no requiere recarga si ya tiene energía suficiente", () => {
    const res = planCharging([v({ socPercent: 100, energyNeedKwh: 5 })]);
    expect(res.plans[0]!.energyKwh).toBe(0);
    expect(res.plans[0]!.reasonEs).toMatch(/no requiere/i);
  });

  it("marca en riesgo cuando la ruta excede la batería", () => {
    const res = planCharging([v({ batteryKwh: 11.52, energyNeedKwh: 20 })]);
    expect(res.plans[0]!.ready).toBe(false);
    expect(res.atRisk).toContain("v1");
    expect(res.plans[0]!.reasonEs).toMatch(/excede la batería/);
  });

  it("agrega energía y costo de toda la flota", () => {
    const res = planCharging([
      v({ id: "a", socPercent: 20, energyNeedKwh: 6 }),
      v({ id: "b", socPercent: 30, energyNeedKwh: 6 }),
    ]);
    expect(res.totalEnergyKwh).toBeGreaterThan(0);
    expect(res.totalCostCop).toBe(res.plans.reduce((s, p) => s + p.estCostCop, 0));
  });

  it("la tarifa por defecto tiene el valle como la más barata", () => {
    const cheapest = DEFAULT_TARIFF.reduce((a, b) => (b.copPerKwh < a.copPerKwh ? b : a));
    expect(cheapest.label).toBe("Valle (noche)");
  });
});
