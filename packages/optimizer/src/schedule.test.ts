import { describe, expect, it } from "vitest";
import { planSchedule, type ScheduleDriver } from "./schedule.js";

const drivers = (n: number): ScheduleDriver[] =>
  Array.from({ length: n }, (_, i) => ({ id: `d${i}`, name: `Conductor ${i}` }));

describe("planSchedule (turnos y oleadas)", () => {
  it("reparte la demanda en oleadas AM/PM (60/40) y cubre con conductores suficientes", () => {
    const res = planSchedule({ totalOrders: 36, drivers: drivers(4) }); // 18/parada
    expect(res.waves).toHaveLength(2);
    expect(res.waves[0]!.label).toBe("Oleada AM");
    expect(res.waves[0]!.demand).toBe(22); // round(36*0.6)
    expect(res.waves[1]!.demand).toBe(14);
    expect(res.coveragePct).toBe(100);
    expect(res.waves.every((w) => !w.overloaded)).toBe(true);
  });

  it("marca sobrecarga y baja cobertura con pocos conductores", () => {
    const res = planSchedule({ totalOrders: 100, drivers: drivers(2) }); // cap 36 < 100
    expect(res.coveragePct).toBeLessThan(100);
    expect(res.waves.some((w) => w.overloaded)).toBe(true);
    expect(res.driversUsed).toBe(2);
  });

  it("reporta conductores ociosos cuando sobran", () => {
    const res = planSchedule({ totalOrders: 10, drivers: drivers(5) });
    expect(res.idleDrivers).toBeGreaterThan(0);
    expect(res.driversUsed + res.idleDrivers).toBe(5);
  });

  it("sin pedidos: cobertura 100% y nadie asignado", () => {
    const res = planSchedule({ totalOrders: 0, drivers: drivers(3) });
    expect(res.coveragePct).toBe(100);
    expect(res.driversUsed).toBe(0);
  });

  it("sin conductores: cobertura 0% y todo sobrecargado", () => {
    const res = planSchedule({ totalOrders: 20, drivers: [] });
    expect(res.coveragePct).toBe(0);
    expect(res.waves.every((w) => w.overloaded)).toBe(true);
  });
});
