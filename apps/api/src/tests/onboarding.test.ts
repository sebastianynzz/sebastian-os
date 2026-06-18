import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Onboarding guiado (Tier 3 §14): /onboarding/checklist refleja el estado real
 * del tenant (depósito, vehículo, conductor, primer pedido, facturación). Los
 * pasos se marcan a medida que se crean los recursos. Tenant-scoped.
 */
const runId = Date.now();
const adminEmail = `onb+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function api(
  method: "GET" | "POST" | "PATCH",
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

function stepDone(body: any, key: string): boolean {
  return body.steps.find((s: any) => s.key === key)?.done === true;
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const reg = await api("POST", "/auth/register", undefined, {
    tenantName: "Onboarding Co",
    adminName: "Admin",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = reg.body!.tenant.id;
  adminToken = reg.body!.token;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("Onboarding guiado (Tier 3 §14)", () => {
  it("un tenant nuevo arranca con todos los pasos pendientes", async () => {
    const res = await api("GET", "/onboarding/checklist", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(5);
    expect(res.body.completed).toBe(0);
  });

  it("crear recursos marca los pasos correspondientes", async () => {
    await api("POST", "/depots", adminToken, {
      name: "Depósito Centro",
      lat: 4.6486,
      lng: -74.0628,
      isMain: true,
    });
    await api("POST", "/vehicles", adminToken, {
      plate: "ONB1Z9",
      type: "IONAX",
      capacityKg: 600,
      isElectric: true,
      nominalRangeKm: 200,
    });
    await api("POST", "/orders", adminToken, {
      customerName: "Destino Onb",
      customerPhone: "+573111111200",
      addressRaw: "Cra 13 # 54-20",
      lat: 4.6416,
      lng: -74.0639,
    });
    await api("PATCH", "/controls/billing", adminToken, { nit: "900999888-1" });

    const res = await api("GET", "/onboarding/checklist", adminToken);
    expect(stepDone(res.body, "depot")).toBe(true);
    expect(stepDone(res.body, "vehicle")).toBe(true);
    expect(stepDone(res.body, "order")).toBe(true);
    expect(stepDone(res.body, "billing")).toBe(true);
    // Sin conductor todavía → ese paso sigue pendiente.
    expect(stepDone(res.body, "driver")).toBe(false);
    expect(res.body.completed).toBe(4);
  });
});
