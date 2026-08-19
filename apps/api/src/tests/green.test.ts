import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Informe verde mensual (CO₂): ciclo completo con una van eléctrica — plan →
 * despacho → entrega → informe del tenant (por tipo de vehículo y por cliente)
 * e informe del negocio en su portal. Un EV debe mostrar ahorro frente a la
 * línea base de combustión.
 */

const runId = Date.now();
const adminEmail = `green-admin+${runId}@test.moveos.co`;
const driverEmail = `green-driver+${runId}@test.moveos.co`;
const portalEmail = `green-portal+${runId}@test.moveos.co`;

// Mes del plan: el actual, para que el informe por defecto lo encuentre.
const month = new Date().toISOString().slice(0, 7);
const planDate = `${month}-15`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;
let clientId: string;

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

  const reg = await api("POST", "/auth/register", undefined, {
    tenantName: "Test Verde",
    adminName: "Admin Verde",
    city: "Bogotá",
    email: adminEmail,
    password: "dalego123",
  });
  tenantId = reg.body.tenant.id;
  adminToken = reg.body.token;
  // El informe del tenant vive en Analítica Pro.
  await api("PATCH", "/modules/ANALYTICS_PRO", adminToken, { enabled: true });
});

afterAll(async () => {
  if (tenantId) {
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  }
  await app.close();
  await prisma.$disconnect();
});

describe("informe verde mensual (CO₂)", () => {
  it("entrega dos envíos de un cliente con una van eléctrica", async () => {
    const client = await api("POST", "/clients", adminToken, {
      name: "Cliente Verde",
      notifyChannel: "IN_APP",
    });
    clientId = client.body.id;

    const driver = await api("POST", "/drivers", adminToken, {
      name: "Conductor Verde",
      phone: "+573000000088",
      documentId: "900900902",
      email: driverEmail,
      password: "dalego123",
    });
    await api("POST", "/vehicles", adminToken, {
      plate: "EVG10A",
      type: "IONAX",
      capacityKg: 700,
      isElectric: true,
      batteryKwh: 42,
      nominalRangeKm: 230,
    });

    const orders = [];
    for (const [i, dest] of [
      { addressRaw: "Cl 72 # 10-34", lat: 4.6585, lng: -74.0577 },
      { addressRaw: "Cra 15 # 93-60", lat: 4.6766, lng: -74.0488 },
    ].entries()) {
      const res = await api("POST", "/orders", adminToken, {
        clientId,
        customerName: `Verde ${i + 1}`,
        customerPhone: `+57311111115${i}`,
        ...dest,
      });
      expect(res.status).toBe(201);
      orders.push(res.body);
    }

    const vehicles = await api("GET", "/vehicles", adminToken);
    const plan = await api("POST", "/optimization/plans", adminToken, {
      date: planDate,
      depot: { lat: 4.6486, lng: -74.0628 },
      orderIds: orders.map((o) => o.id),
      vehicleIds: vehicles.body.map((v: { id: string }) => v.id),
    });
    expect(plan.status).toBe(201);
    expect(plan.body.routes.length).toBe(1);
    const routeId = plan.body.routes[0].id;

    await api("POST", `/routes/${routeId}/dispatch`, adminToken, {
      driverId: driver.body.id,
    });
    const login = await api("POST", "/auth/login", undefined, {
      email: driverEmail,
      password: "dalego123",
    });
    const driverToken = login.body.token;
    await api("POST", `/routes/${routeId}/start`, driverToken);

    const route = await api("GET", `/routes/${routeId}`, adminToken);
    for (const stop of route.body.stops) {
      const done = await api(
        "POST",
        `/routes/stops/${stop.id}/complete`,
        driverToken,
        { types: ["GEOFENCE"], lat: stop.order.lat, lng: stop.order.lng },
      );
      expect(done.status).toBe(200);
    }
  });

  it("el informe del tenant muestra km, CO₂, ahorro EV y desglose por cliente", async () => {
    const res = await api(
      "GET",
      `/analytics/green-report?month=${month}`,
      adminToken,
    );
    expect(res.status).toBe(200);
    const r = res.body;

    expect(r.month).toBe(month);
    expect(r.totalKm).toBeGreaterThan(0);
    expect(r.deliveredOrders).toBe(2);
    // Van eléctrica: emite poco pero más que cero, y ahorra frente a la
    // línea base de una van a combustión.
    expect(r.co2Kg).toBeGreaterThan(0);
    expect(r.co2Kg).toBeLessThan(r.co2BaselineKg);
    expect(r.co2SavedKg).toBeGreaterThan(0);
    expect(r.electricSharePct).toBe(100);

    expect(r.byVehicleType.length).toBe(1);
    expect(r.byVehicleType[0].type).toBe("IONAX");
    expect(r.byVehicleType[0].isElectric).toBe(true);

    expect(r.byClient.length).toBe(1);
    expect(r.byClient[0].clientId).toBe(clientId);
    expect(r.byClient[0].name).toBe("Cliente Verde");
    expect(r.byClient[0].deliveredOrders).toBe(2);
  });

  it("un mes sin operación devuelve ceros", async () => {
    const res = await api("GET", "/analytics/green-report?month=2020-01", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.totalKm).toBe(0);
    expect(res.body.deliveredOrders).toBe(0);
  });

  it("el negocio ve SU informe verde en el portal", async () => {
    await api("POST", `/clients/${clientId}/portal-access`, adminToken, {
      email: portalEmail,
      password: "dalego123",
    });
    const login = await api("POST", "/auth/login", undefined, {
      email: portalEmail,
      password: "dalego123",
    });

    const res = await api(
      "GET",
      `/portal/green-report?month=${month}`,
      login.body.token,
    );
    expect(res.status).toBe(200);
    const r = res.body;
    expect(r.deliveredOrders).toBe(2);
    expect(r.orders.length).toBe(2);
    expect(r.co2SavedKg).toBeGreaterThan(0);
    expect(r.orders[0].vehicle.isElectric).toBe(true);
    expect(r.orders[0].trackingNumber).toMatch(/^DG-/);
  });
});
