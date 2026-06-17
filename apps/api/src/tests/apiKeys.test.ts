import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * API keys + ingesta (Tier 2 §8): el tenant emite keys con scopes; un sistema
 * externo crea pedidos vía /ingest/orders con la key. La key en claro se ve una
 * vez; el listado nunca expone el hash. Scopes y aislamiento aplicados.
 */
const runId = Date.now();
const adminEmail = `apik+${runId}@test.moveos.co`;
let app: FastifyInstance;
let tenantId: string;
let adminToken: string;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function api(
  method: "GET" | "POST" | "DELETE",
  url: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: body as object | undefined,
  });
  return { status: res.statusCode, body: res.body ? res.json() : undefined };
}

const orderBody = {
  customerName: "Destino API",
  customerPhone: "+573111111180",
  addressRaw: "Cra 13 # 54-20",
  lat: 4.64,
  lng: -74.06,
};

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const reg = await api("POST", "/auth/register", undefined, {
    tenantName: "ApiKey Co",
    adminName: "Admin",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = reg.body.tenant.id;
  adminToken = reg.body.token;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("API keys + ingesta (Tier 2 §8)", () => {
  let writeKey: string;
  let writeKeyId: string;

  it("emite una key (en claro una vez) y la lista sin exponer el hash", async () => {
    const res = await api("POST", "/developer/api-keys", adminToken, {
      name: "Tienda X",
      scopes: ["orders:write"],
    });
    expect(res.status).toBe(201);
    expect(res.body.key).toMatch(/^mk_live_/);
    expect(res.body.prefix).toMatch(/^mk_live_/);
    writeKey = res.body.key;
    writeKeyId = res.body.id;

    const list = await api("GET", "/developer/api-keys", adminToken);
    const row = (list.body as any[]).find((k) => k.id === writeKeyId);
    expect(row).toBeDefined();
    expect(row.key).toBeUndefined();
    expect(row.hashedKey).toBeUndefined();
  });

  it("crea un pedido por ingesta con la API key", async () => {
    const res = await api("POST", "/ingest/orders", writeKey, orderBody);
    expect(res.status).toBe(201);
    expect(res.body.trackingNumber).toMatch(/^MV-/);
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: res.body.id },
      select: { tenantId: true },
    });
    expect(order.tenantId).toBe(tenantId);
  });

  it("rechaza la ingesta sin key (401) y con key inválida (401)", async () => {
    expect((await api("POST", "/ingest/orders", undefined, orderBody)).status).toBe(401);
    expect((await api("POST", "/ingest/orders", "mk_live_invalida", orderBody)).status).toBe(401);
  });

  it("rechaza la ingesta si la key no tiene el scope orders:write (403)", async () => {
    const ro = await api("POST", "/developer/api-keys", adminToken, {
      name: "Solo lectura",
      scopes: ["orders:read"],
    });
    const res = await api("POST", "/ingest/orders", ro.body.key, orderBody);
    expect(res.status).toBe(403);
  });

  it("revoca la key (204) y deja de funcionar (401)", async () => {
    expect((await api("DELETE", `/developer/api-keys/${writeKeyId}`, adminToken)).status).toBe(204);
    expect((await api("POST", "/ingest/orders", writeKey, orderBody)).status).toBe(401);
  });
});
