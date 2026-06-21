import { describe, expect, it } from "vitest";
import {
  signEvidencePath,
  verifyEvidenceSignature,
  resolveEvidenceRef,
  sniffImageType,
  POD_KEY_RE,
} from "../services/storage.js";

/**
 * Evidencia POD firmada (MO-03): la clave privada se sirve por una URL firmada de
 * corta duración; nadie sin la firma válida (ni con una expirada) puede acceder.
 * Sin BD.
 */
describe("evidencia POD firmada", () => {
  const key = "pod/tenant123/" + "a".repeat(32) + ".jpg";

  it("la clave tiene forma segura", () => {
    expect(POD_KEY_RE.test(key)).toBe(true);
    expect(POD_KEY_RE.test("pod/../etc/passwd")).toBe(false);
    expect(POD_KEY_RE.test("pod/t/x.html")).toBe(false);
  });

  it("firma y verifica un ida y vuelta válido", () => {
    const url = signEvidencePath(key);
    const u = new URL(url);
    expect(u.pathname).toBe("/evidence");
    const exp = Number(u.searchParams.get("exp"));
    const sig = u.searchParams.get("sig")!;
    expect(verifyEvidenceSignature(key, exp, sig)).toBe(true);
  });

  it("rechaza firma alterada, clave alterada y expiración pasada", () => {
    const u = new URL(signEvidencePath(key));
    const exp = Number(u.searchParams.get("exp"));
    const sig = u.searchParams.get("sig")!;
    expect(verifyEvidenceSignature(key, exp, "deadbeef")).toBe(false);
    expect(verifyEvidenceSignature(key + "x", exp, sig)).toBe(false);
    expect(verifyEvidenceSignature(key, Date.now() - 1000, sig)).toBe(false);
  });

  it("resolveEvidenceRef firma claves y deja pasar URLs legadas", () => {
    expect(resolveEvidenceRef(key)).toContain("/evidence?key=");
    expect(resolveEvidenceRef("https://cdn.moveos.co/pod/x.jpg")).toBe(
      "https://cdn.moveos.co/pod/x.jpg",
    );
    expect(resolveEvidenceRef(null)).toBeNull();
  });

  it("sniffImageType reconoce PNG y rechaza HTML", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 0]);
    expect(sniffImageType(png)).toBe("image/png");
    expect(sniffImageType(Buffer.from("<script>alert(1)</script>"))).toBeNull();
  });
});
