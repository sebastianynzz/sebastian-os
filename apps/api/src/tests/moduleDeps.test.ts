import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Grafo de dependencias entre módulos: habilitar uno arrastra sus deps en
 * cascada (SAFETY → TELEMATICS); no se puede desactivar un módulo del que
 * dependa otro habilitado. El servidor es la fuente de verdad.
 */

const runId = Date.now();
const adminEmail = `mods+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;

async function api(
  method: "GET" | "PATCH" | "POST",
  url: string,
  token?: string,
  body?: unknown,
) {
  const res = await app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: body as object | undefined,
  });
  return { status: res.statusCode, body: res.json() };
}

async function enabledMap(): Promise<Record<string, boolean>> {
  const res = await api("GET", "/modules", adminToken);
  const map: Record<string, boolean> = {};
  for (const m of res.body as { key: string; enabled: boolean }[]) {
    map[m.key] = m.enabled;
  }
  return map;
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const reg = await api("POST", "/auth/register", undefined, {
    tenantName: "Modulos Co",
    adminName: "Admin Mods",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = reg.body.tenant.id;
  adminToken = reg.body.token;
});

afterAll(async () => {
  if (tenantId) {
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  }
  await app.close();
  await prisma.$disconnect();
});

describe("grafo de dependencias de módulos", () => {
  it("habilitar SAFETY arrastra TELEMATICS en cascada", async () => {
    const before = await enabledMap();
    expect(before.TELEMATICS).toBe(false);

    const res = await api("PATCH", "/modules/SAFETY", adminToken, { enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toContain("SAFETY");
    expect(res.body.enabled).toContain("TELEMATICS");

    const after = await enabledMap();
    expect(after.SAFETY).toBe(true);
    expect(after.TELEMATICS).toBe(true);
  });

  it("bloquea desactivar TELEMATICS mientras SAFETY depende de él (409)", async () => {
    const res = await api("PATCH", "/modules/TELEMATICS", adminToken, {
      enabled: false,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MODULE_DEPENDENCY");
    expect(res.body.blockedBy).toContain("SAFETY");
  });

  it("tras desactivar SAFETY, ya se puede desactivar TELEMATICS", async () => {
    const off = await api("PATCH", "/modules/SAFETY", adminToken, { enabled: false });
    expect(off.status).toBe(200);

    const res = await api("PATCH", "/modules/TELEMATICS", adminToken, {
      enabled: false,
    });
    expect(res.status).toBe(200);

    const after = await enabledMap();
    expect(after.TELEMATICS).toBe(false);
  });
});
