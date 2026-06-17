import { describe, expect, it } from "vitest";
import { sequenceColdChain, type ColdStopInput } from "./coldChain.js";

const stop = (orderId: string, tempProfile: ColdStopInput["tempProfile"]): ColdStopInput => ({
  orderId,
  tempProfile,
});

describe("sequenceColdChain (secuenciación de cadena de frío)", () => {
  it("prioriza FROZEN, luego CHILLED, luego AMBIENT", () => {
    const res = sequenceColdChain([
      stop("a", "AMBIENT"),
      stop("c", "CHILLED"),
      stop("f", "FROZEN"),
    ]);
    expect(res.order).toEqual(["f", "c", "a"]);
    expect(res.movedCount).toBeGreaterThan(0);
  });

  it("conserva el orden relativo dentro de un mismo perfil (estable)", () => {
    const res = sequenceColdChain([
      stop("c1", "CHILLED"),
      stop("c2", "CHILLED"),
      stop("f1", "FROZEN"),
    ]);
    expect(res.order).toEqual(["f1", "c1", "c2"]);
  });

  it("el pre-enfriamiento usa el perfil más exigente (FROZEN → 45 min)", () => {
    expect(sequenceColdChain([stop("f", "FROZEN")]).preCoolLeadMin).toBe(45);
    expect(sequenceColdChain([stop("c", "CHILLED")]).preCoolLeadMin).toBe(30);
    expect(sequenceColdChain([stop("a", "AMBIENT")]).preCoolLeadMin).toBe(0);
  });

  it("una ruta solo-AMBIENT no mueve nada y reporta sin sensibles", () => {
    const res = sequenceColdChain([stop("a", "AMBIENT"), stop("b", "AMBIENT")]);
    expect(res.movedCount).toBe(0);
    expect(res.sensitiveCount).toBe(0);
    expect(res.timeInBandPct).toBe(100);
  });

  it("ubica las entregas sensibles en la primera mitad (timeInBand alto)", () => {
    const res = sequenceColdChain([
      stop("a", "AMBIENT"),
      stop("b", "AMBIENT"),
      stop("f", "FROZEN"),
      stop("c", "CHILLED"),
    ]);
    expect(res.order.slice(0, 2)).toEqual(["f", "c"]);
    expect(res.timeInBandPct).toBe(100);
  });
});
