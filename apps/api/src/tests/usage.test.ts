import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Medición de uso + upsell (Tier 3 §12): /usage reporta el consumo del mes
 * actual (pedidos, campos personalizados, conductores) frente a los límites del
 * plan. Informativo (no bloquea). Tenant-scoped.
 */
const runId = Date.now();
const adminEmail = `usage+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function api(
  method: "GET" | "POST",
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
  let parsed: any;
  try {
    parsed = res.body ? res.json() : undefined;
  } catch {
    parsed = undefined;
  }
  return { status: res.statusCode, body: parsed };
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const reg = await api("POST", "/auth/register", undefined, {
    tenantName: "Usage Co",
    adminName: "Admin",
    city: "Bogotá",
    email: adminEmail,
    password: "dalego123",
  });
  tenantId = reg.body!.tenant.id;
  adminToken = reg.body!.token;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("Medición de uso + upsell (Tier 3 §12)", () => {
  it("reporta el plan y los límites por defecto (FREE)", async () => {
    const res = await api("GET", "/usage", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.plan).toBe("FREE");
    expect(res.body.limits).toMatchObject({
      ordersPerMonth: 500,
      customProperties: 3,
      drivers: 3,
    });
    expect(res.body.month).toMatch(/^\d{4}-\d{2}$/);
  });

  it("cuenta el uso del mes (pedidos + campos) tras crearlos", async () => {
    const before = await api("GET", "/usage", adminToken);
    const baseOrders = before.body.usage.ordersThisMonth;

    await api("POST", "/orders", adminToken, {
      customerName: "Destino Uso",
      customerPhone: "+573111111190",
      addressRaw: "Cra 13 # 54-20",
      lat: 4.6416,
      lng: -74.0639,
    });
    await api("POST", "/custom-properties", adminToken, { name: "Piso" });

    const after = await api("GET", "/usage", adminToken);
    expect(after.body.usage.ordersThisMonth).toBe(baseOrders + 1);
    expect(after.body.usage.customProperties).toBe(1);
  });
});
