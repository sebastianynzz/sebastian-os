import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Idempotencia de creación de pedidos: un reintento de API o un re-import del
 * mismo CSV (mismo externalRef) no debe duplicar el pedido — se devuelve el
 * existente. Los pedidos manuales (sin externalRef) no se ven afectados.
 */

const runId = Date.now();
const adminEmail = `idem+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;

async function api(method: "POST", url: string, token?: string, body?: unknown) {
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
  const reg = await api("POST", "/auth/register", undefined, {
    tenantName: "Idempotencia Co",
    adminName: "Admin Idem",
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

describe("creación de pedidos idempotente por externalRef", () => {
  const order = {
    externalRef: "EXT-REINTENTO-1",
    customerName: "Cliente Idem",
    customerPhone: "+573101000001",
    addressRaw: "Cra 13 # 54-20",
    lat: 4.6416,
    lng: -74.0639,
  };

  it("el mismo externalRef devuelve el mismo pedido, sin duplicar", async () => {
    const first = await api("POST", "/orders", adminToken, order);
    expect(first.status).toBe(201);
    const second = await api("POST", "/orders", adminToken, order);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);

    const count = await prisma.order.count({
      where: { tenantId, externalRef: "EXT-REINTENTO-1" },
    });
    expect(count).toBe(1);
  });

  it("pedidos sin externalRef sí crean filas distintas", async () => {
    const base = {
      customerName: "Manual",
      customerPhone: "+573102000002",
      addressRaw: "Cl 72 # 10-34",
      lat: 4.66,
      lng: -74.05,
    };
    const a = await api("POST", "/orders", adminToken, base);
    const b = await api("POST", "/orders", adminToken, base);
    expect(a.body.id).not.toBe(b.body.id);
  });
});
