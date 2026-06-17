import { describe, expect, it } from "vitest";
import { failStopSchema } from "@moveos/shared";

/**
 * Evidencia obligatoria en fallos disputables (fuente de verdad = servidor).
 * El endpoint /routes/stops/:id/fail valida con este mismo esquema, así que un
 * fallo disputable SIN foto se rechaza aunque llegue reproducido desde la cola
 * offline ("offline no puede saltarse la evidencia").
 */
describe("failStopSchema — evidencia obligatoria", () => {
  it("rechaza CLIENTE_AUSENTE sin foto", () => {
    const r = failStopSchema.safeParse({ reason: "CLIENTE_AUSENTE" });
    expect(r.success).toBe(false);
  });

  it("rechaza RECHAZO_PRODUCTO sin foto", () => {
    const r = failStopSchema.safeParse({ reason: "RECHAZO_PRODUCTO" });
    expect(r.success).toBe(false);
  });

  it("acepta CLIENTE_AUSENTE con foto", () => {
    const r = failStopSchema.safeParse({
      reason: "CLIENTE_AUSENTE",
      photoUrl: "https://cdn.moveos.co/pod/x.jpg",
    });
    expect(r.success).toBe(true);
  });

  it("acepta motivos NO disputables sin foto (p. ej. ZONA_INSEGURA)", () => {
    expect(failStopSchema.safeParse({ reason: "ZONA_INSEGURA" }).success).toBe(true);
    expect(failStopSchema.safeParse({ reason: "DIRECCION_ERRADA" }).success).toBe(true);
  });
});
