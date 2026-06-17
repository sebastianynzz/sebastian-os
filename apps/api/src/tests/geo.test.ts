import { describe, expect, it } from "vitest";
import { pointInPolygon, type LatLng } from "@moveos/shared";

/**
 * Prueba unitaria del cálculo determinista de cobertura por zona (sin BD).
 * `pointInPolygon` es la base de la verificación point-in-zone al crear pedidos.
 */
// Cuadrado ~Bogotá: lat 4.60–4.70, lng -74.10 … -74.00.
const square: LatLng[] = [
  { lat: 4.6, lng: -74.1 },
  { lat: 4.7, lng: -74.1 },
  { lat: 4.7, lng: -74.0 },
  { lat: 4.6, lng: -74.0 },
];

describe("pointInPolygon", () => {
  it("detecta un punto dentro del polígono", () => {
    expect(pointInPolygon({ lat: 4.65, lng: -74.05 }, square)).toBe(true);
  });

  it("detecta puntos fuera del polígono", () => {
    expect(pointInPolygon({ lat: 4.8, lng: -74.05 }, square)).toBe(false);
    expect(pointInPolygon({ lat: 4.65, lng: -73.9 }, square)).toBe(false);
  });

  it("un polígono con menos de 3 vértices nunca contiene", () => {
    expect(pointInPolygon({ lat: 4.65, lng: -74.05 }, square.slice(0, 2))).toBe(false);
  });
});
