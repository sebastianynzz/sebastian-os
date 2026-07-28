import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { evKwhForKm } from "@moveos/shared";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { resetModuleEntitlementCache } from "../plugins/entitlements.js";

/**
 * Costo por entrega energía-nativo (D6): configuración de costos del tenant
 * (/controls/cost) e informe /analytics/cost. El costo sale de horas × costo/hora
 * + kWh × tarifa, nunca de combustible. Gated por ANALYTICS_PRO.
 */
const runId = Date.now();
const adminEmail = `cost+${runId}@test.moveos.co`;
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
  return { status: res.statusCode, body: res.body ? res.json() : undefined };
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const reg = await api("POST", "/auth/register", undefined, {
    tenantName: "Cost Co",
    adminName: "Admin",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = reg.body.tenant.id;
  adminToken = reg.body.token;
  for (const moduleKey of ["ANALYTICS_PRO", "ROUTE_OPTIMIZATION"]) {
    await prisma.moduleEntitlement.upsert({
      where: { tenantId_moduleKey: { tenantId, moduleKey } },
      create: { tenantId, moduleKey, enabled: true },
      update: { enabled: true },
    });
    // Escritura directa con Prisma: el caché TTL de entitlements no se entera.
    resetModuleEntitlementCache();
  }
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("evKwhForKm (unidad)", () => {
  it("es proporcional a la distancia y positivo para un EV", () => {
    const ten = evKwhForKm("IONAX", 10);
    expect(ten).toBeGreaterThan(0);
    expect(evKwhForKm("IONAX", 20)).toBeCloseTo(ten * 2);
  });
});

describe("Costo por entrega energía-nativo (D6)", () => {
  it("/controls/cost devuelve defaults y acepta cambios (ADMIN)", async () => {
    const def = await api("GET", "/controls/cost", adminToken);
    expect(def.status).toBe(200);
    expect(def.body.driverCostPerHourCop).toBe(12000);
    expect(def.body.energyTariffCop).toBe(800);

    const patched = await api("PATCH", "/controls/cost", adminToken, {
      driverCostPerHourCop: 20000,
      energyTariffCop: 1000,
    });
    expect(patched.status).toBe(200);
    expect(patched.body.driverCostPerHourCop).toBe(20000);
    expect(patched.body.energyTariffCop).toBe(1000);
  });

  it("/analytics/cost calcula costo por entrega sobre las rutas del rango", async () => {
    const vehicle = await api("POST", "/vehicles", adminToken, {
      plate: "COST1Z",
      type: "IONAX",
      capacityKg: 600,
      isElectric: true,
      nominalRangeKm: 200,
    });
    const order = await api("POST", "/orders", adminToken, {
      customerName: "Destino Costo",
      customerPhone: "+573111111150",
      addressRaw: "Cra 13 # 54-20",
      lat: 4.6416,
      lng: -74.0639,
    });
    const plan = await api("POST", "/optimization/plans", adminToken, {
      date: "2026-06-22",
      depot: { lat: 4.6486, lng: -74.0628 },
      orderIds: [order.body.id],
      vehicleIds: [vehicle.body.id],
    });
    expect(plan.status).toBe(201);

    const cost = await api("GET", "/analytics/cost?from=2026-06-22&to=2026-06-22", adminToken);
    expect(cost.status).toBe(200);
    expect(cost.body.routes).toBeGreaterThanOrEqual(1);
    expect(cost.body.stops).toBeGreaterThanOrEqual(1);
    expect(cost.body.totalKwh).toBeGreaterThan(0);
    expect(cost.body.driverCostPerHourCop).toBe(20000);
    expect(cost.body.totalCostCop).toBe(cost.body.laborCostCop + cost.body.energyCostCop);
    expect(cost.body.costPerDeliveryCop).toBeGreaterThan(0);
  });
});
