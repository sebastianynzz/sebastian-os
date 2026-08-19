import { describe, expect, it } from "vitest";
import {
  MAX_TRACK_POINTS,
  RETENTION_DAYS,
  downsampleTrack,
  retentionCutoff,
} from "../services/routeTrack.js";

/**
 * Pruebas puras del submuestreo de trazas y del corte de retención. Sin base
 * de datos: la poda real NO se prueba aquí porque la suite comparte una sola
 * base en serie y un borrado real arrastraría filas de otros archivos.
 */

interface PingOverrides {
  lat?: number;
  lng?: number;
  recordedAt?: Date;
  batterySoc?: number | null;
}

function makePing(i: number, overrides: PingOverrides = {}) {
  return {
    lat: 4.6 + i / 10_000,
    lng: -74.08 + i / 10_000,
    recordedAt: new Date(Date.UTC(2026, 6, 1, 12, 0, i)),
    batterySoc: 100 - i / 100,
    ...overrides,
  };
}

const makePings = (n: number) => Array.from({ length: n }, (_, i) => makePing(i));

describe("submuestreo de la traza de una ruta", () => {
  it("devuelve vacío si la ruta no tiene pings", () => {
    expect(downsampleTrack([])).toEqual([]);
  });

  it("no toca la traza si cabe bajo el tope", () => {
    const track = downsampleTrack(makePings(10));
    expect(track).toHaveLength(10);
  });

  it("conserva el primer y el último punto al submuestrear", () => {
    const pings = makePings(5_000);
    const track = downsampleTrack(pings);

    expect(track[0]!.lat).toBe(pings[0]!.lat);
    expect(track[0]!.t).toBe(pings[0]!.recordedAt.toISOString());
    expect(track.at(-1)!.lat).toBe(pings.at(-1)!.lat);
    expect(track.at(-1)!.t).toBe(pings.at(-1)!.recordedAt.toISOString());
  });

  it("respeta el tope de puntos (trackJson no debe engordar la fila)", () => {
    expect(downsampleTrack(makePings(50_000)).length).toBeLessThanOrEqual(
      MAX_TRACK_POINTS,
    );
    expect(downsampleTrack(makePings(1_000), 50)).toHaveLength(50);
  });

  it("mantiene el orden cronológico y no duplica puntos", () => {
    const track = downsampleTrack(makePings(5_000));
    const times = track.map((p) => new Date(p.t).getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i]!).toBeGreaterThan(times[i - 1]!);
    }
  });

  it("conserva el SoC y tolera pings sin batería reportada", () => {
    const track = downsampleTrack([
      makePing(0, { batterySoc: 87 }),
      makePing(1, { batterySoc: null }),
    ]);
    expect(track[0]!.soc).toBe(87);
    expect(track[1]!.soc).toBeNull();
  });

  it("NO arrastra campos de combustión a la traza (EV-only)", () => {
    const track = downsampleTrack(makePings(3));
    for (const point of track) {
      expect(Object.keys(point).sort()).toEqual(["lat", "lng", "soc", "t"]);
    }
  });
});

describe("corte de retención", () => {
  it("es determinista: recibe `now`, no lee el reloj", () => {
    const now = new Date("2026-07-28T12:00:00.000Z");
    expect(retentionCutoff(now, 90).toISOString()).toBe(
      "2026-04-29T12:00:00.000Z",
    );
    // Misma entrada, misma salida — imprescindible para backfills y pruebas.
    expect(retentionCutoff(now, 90)).toEqual(retentionCutoff(now, 90));
  });

  it("usa 90 días por defecto", () => {
    const now = new Date("2026-07-28T00:00:00.000Z");
    expect(retentionCutoff(now).getTime()).toBe(
      retentionCutoff(now, RETENTION_DAYS).getTime(),
    );
    expect(RETENTION_DAYS).toBe(90);
  });

  it("el corte siempre queda en el pasado", () => {
    const now = new Date("2026-07-28T00:00:00.000Z");
    expect(retentionCutoff(now).getTime()).toBeLessThan(now.getTime());
  });
});
