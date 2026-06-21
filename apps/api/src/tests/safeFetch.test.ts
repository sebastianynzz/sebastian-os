import { describe, expect, it } from "vitest";
import { isBlockedIp, assertPublicUrl, BlockedUrlError } from "../lib/safeFetch.js";

/**
 * Cobertura del núcleo de la guarda anti-SSRF (`isBlockedIp` + validación de
 * esquema). El bloqueo de IPs internas se omite en la entrega real de webhooks
 * SOLO bajo NODE_ENV="test" (servidores mock en loopback), así que aquí se prueba
 * la lógica pura, que no depende del entorno.
 */
describe("safeFetch / isBlockedIp", () => {
  it("bloquea loopback, privadas, link-local (metadatos) y CGNAT (IPv4)", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254", // metadatos del cloud
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1", // CGNAT
      "0.0.0.0",
      "224.0.0.1", // multicast
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("bloquea loopback / link-local / unique-local y IPv4-mapeado (IPv6)", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12::1", "::ffff:127.0.0.1"]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("permite IPs públicas", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "93.184.216.34", "2606:4700:4700::1111"]) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });

  it("rechaza esquemas que no son http(s) y URLs inválidas", async () => {
    await expect(assertPublicUrl("ftp://example.com")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertPublicUrl("no-es-una-url")).rejects.toBeInstanceOf(BlockedUrlError);
  });
});
