import { describe, expect, it } from "vitest";
import { submitPodSchema } from "@moveos/shared";

/**
 * Integridad del POD (fuente de verdad = servidor): /routes/stops/:id/complete
 * valida con este esquema, así que una entrega no puede declarar una prueba
 * (foto/firma/OTP/geocerca) sin su evidencia, ni siquiera reproducida desde la
 * cola offline.
 */
describe("submitPodSchema — la prueba declarada exige su evidencia", () => {
  it("rechaza PHOTO sin photoUrl", () => {
    expect(submitPodSchema.safeParse({ types: ["PHOTO"] }).success).toBe(false);
  });

  it("acepta PHOTO con photoUrl", () => {
    expect(
      submitPodSchema.safeParse({
        types: ["PHOTO"],
        photoUrl: "https://cdn.moveos.co/pod/x.jpg",
      }).success,
    ).toBe(true);
  });

  it("rechaza GEOFENCE sin coordenadas", () => {
    expect(submitPodSchema.safeParse({ types: ["GEOFENCE"] }).success).toBe(false);
  });

  it("acepta GEOFENCE con lat y lng", () => {
    expect(
      submitPodSchema.safeParse({ types: ["GEOFENCE"], lat: 4.64, lng: -74.06 }).success,
    ).toBe(true);
  });

  it("rechaza OTP sin código y SIGNATURE sin url", () => {
    expect(submitPodSchema.safeParse({ types: ["OTP"] }).success).toBe(false);
    expect(submitPodSchema.safeParse({ types: ["SIGNATURE"] }).success).toBe(false);
  });
});
