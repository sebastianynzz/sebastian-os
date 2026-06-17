import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Aislamiento multi-tenant y gating (CLAUDE.md restricción dura 3). Guardia de
 * regresión: toda ruta de tenant exige `authenticate`; un token de plataforma
 * NO entra a rutas de tenant y viceversa; un tenant no ve datos de otro; los
 * módulos de pago se cierran sin entitlement.
 */

const runId = Date.now();
const aEmail = `iso-a+${runId}@test.moveos.co`;
const bEmail = `iso-b+${runId}@test.moveos.co`;
const pEmail = `iso-plat+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tokenA: string;
let tokenB: string;
let platformToken: string;
let orderA: string;
let tenantAId: string;
let tenantBId: string;

async function api(
  method: "GET" | "POST" | "PATCH",
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

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  const a = await api("POST", "/auth/register", undefined, {
    tenantName: "Iso A",
    adminName: "Admin A",
    city: "Bogotá",
    email: aEmail,
    password: "moveos123",
  });
  tokenA = a.body.token;
  tenantAId = a.body.tenant.id;

  const b = await api("POST", "/auth/register", undefined, {
    tenantName: "Iso B",
    adminName: "Admin B",
    city: "Bogotá",
    email: bEmail,
    password: "moveos123",
  });
  tokenB = b.body.token;
  tenantBId = b.body.tenant.id;

  await prisma.platformAdmin.create({
    data: {
      email: pEmail,
      name: "Operador Iso",
      passwordHash: await bcrypt.hash("moveos123", 10),
    },
  });
  const plogin = await api("POST", "/platform/auth/login", undefined, {
    email: pEmail,
    password: "moveos123",
  });
  platformToken = plogin.body.token;

  const o = await api("POST", "/orders", tokenA, {
    customerName: "Pedido A",
    customerPhone: "+573110000000",
    addressRaw: "Cl 72 # 10-34",
  });
  orderA = o.body.id;
});

afterAll(async () => {
  for (const id of [tenantAId, tenantBId]) {
    if (id) await prisma.tenant.delete({ where: { id } }).catch(() => {});
  }
  await prisma.platformAdmin.deleteMany({ where: { email: pEmail } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("aislamiento multi-tenant y autenticación", () => {
  const TENANT_GETS = [
    "/orders",
    "/vehicles",
    "/drivers",
    "/clients",
    "/routes",
    "/addresses/triage",
    "/exceptions",
    "/ev/overview",
    "/ai/actions",
  ];

  it("toda ruta de tenant exige token (401 sin autenticar)", async () => {
    for (const url of TENANT_GETS) {
      const res = await api("GET", url);
      expect.soft(res.status, `${url} sin token`).toBe(401);
    }
  });

  it("un token de PLATAFORMA no entra a rutas de tenant (401)", async () => {
    const res = await api("GET", "/orders", platformToken);
    expect(res.status).toBe(401);
  });

  it("un token de TENANT no entra al plano de plataforma (403)", async () => {
    const res = await api("GET", "/platform/metrics", tokenA);
    expect(res.status).toBe(403);
  });

  it("un tenant NO ve pedidos de otro (cross-tenant 404)", async () => {
    const detail = await api("GET", `/orders/${orderA}`, tokenB);
    expect(detail.status).toBe(404);

    const list = await api("GET", "/orders", tokenB);
    expect(list.status).toBe(200);
    const ids = (list.body as { id: string }[]).map((o) => o.id);
    expect(ids).not.toContain(orderA);
  });

  it("el dueño SÍ ve su propio pedido", async () => {
    const detail = await api("GET", `/orders/${orderA}`, tokenA);
    expect(detail.status).toBe(200);
    expect(detail.body.id).toBe(orderA);
  });

  it("los módulos de pago se cierran sin entitlement (403)", async () => {
    // Tenant nuevo: ANALYTICS_PRO no viene por defecto → 403.
    const res = await api("GET", "/analytics/green-report?month=2026-06", tokenA);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("MODULE_NOT_ENABLED");
  });
});
