import { describe, expect, it } from "vitest";
import { slaDueAt, isSlaBreached } from "@moveos/shared";

/**
 * Pruebas unitarias de la lógica determinista del SLA (sin BD). `slaDueAt` e
 * `isSlaBreached` son la base del SLA_BREACH en el cockpit de excepciones y del
 * informe por cliente en analítica: el cálculo lo hace esta función pura.
 */
describe("slaDueAt", () => {
  const base = new Date("2026-06-17T12:00:00.000Z");

  it("suma el plazo (minutos) a la creación del pedido", () => {
    expect(slaDueAt(base, 90).toISOString()).toBe("2026-06-17T13:30:00.000Z");
  });

  it("acepta la fecha como string ISO (mismo resultado que como Date)", () => {
    expect(slaDueAt(base.toISOString(), 30).getTime()).toBe(
      slaDueAt(base, 30).getTime(),
    );
  });

  it("es determinista: no depende del reloj actual", () => {
    expect(slaDueAt(base, 0).getTime()).toBe(base.getTime());
  });
});

describe("isSlaBreached", () => {
  const createdAt = new Date("2026-06-17T12:00:00.000Z");

  it("no incumple antes de la hora límite", () => {
    const now = new Date("2026-06-17T13:00:00.000Z"); // +60 min, plazo 90
    expect(isSlaBreached(createdAt, 90, now)).toBe(false);
  });

  it("incumple pasada la hora límite", () => {
    const now = new Date("2026-06-17T14:00:00.000Z"); // +120 min, plazo 90
    expect(isSlaBreached(createdAt, 90, now)).toBe(true);
  });

  it("justo en la hora límite todavía no incumple (estrictamente mayor)", () => {
    const dueAt = slaDueAt(createdAt, 90);
    expect(isSlaBreached(createdAt, 90, dueAt)).toBe(false);
    expect(isSlaBreached(createdAt, 90, new Date(dueAt.getTime() + 1))).toBe(true);
  });
});
