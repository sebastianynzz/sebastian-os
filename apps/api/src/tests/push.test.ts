import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Web Push (P0.6): suscripciones por usuario con aislamiento de tenant.
 * Sin claves VAPID configuradas (entorno de test) el servicio degrada a
 * no-op: suscribirse funciona, despachar no truena, y /push/vapid-key
 * devuelve null para que el frontend no intente suscribirse.
 */

const runId = Date.now();
const adminEmail = `push-admin+${runId}@test.moveos.co`;
const driverEmail = `push-driver+${runId}@test.moveos.co`;
const endpoint = `https://fcm.googleapis.com/fcm/send/test-${runId}`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;
let driverToken: string;

async function api(
  method: "GET" | "POST" | "DELETE",
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
    tenantName: "Test Push",
    adminName: "Admin Push",
    city: "Bogotá",
    email: adminEmail,
    password: "dalego123",
  });
  tenantId = reg.body.tenant.id;
  adminToken = reg.body.token;

  const driver = await api("POST", "/drivers", adminToken, {
    name: "Conductor Push",
    phone: "+573000000088",
    documentId: "800700600",
    email: driverEmail,
    password: "dalego123",
  });
  expect(driver.status).toBe(201);

  const login = await api("POST", "/auth/login", undefined, {
    email: driverEmail,
    password: "dalego123",
  });
  driverToken = login.body.token;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("web push", () => {
  it("sin VAPID configurado, /push/vapid-key devuelve null", async () => {
    const res = await api("GET", "/push/vapid-key", driverToken);
    expect(res.status).toBe(200);
    expect(res.body.publicKey).toBeNull();
  });

  it("el conductor registra y elimina su suscripción", async () => {
    const sub = await api("POST", "/push/subscriptions", driverToken, {
      endpoint,
      keys: { p256dh: "clave-p256dh", auth: "clave-auth" },
      userAgent: "test",
    });
    expect(sub.status).toBe(201);

    const saved = await prisma.pushSubscription.findUnique({
      where: { endpoint },
    });
    expect(saved?.tenantId).toBe(tenantId);

    // Re-suscribir el mismo endpoint no duplica (upsert).
    const again = await api("POST", "/push/subscriptions", driverToken, {
      endpoint,
      keys: { p256dh: "clave-p256dh-2", auth: "clave-auth-2" },
    });
    expect(again.status).toBe(201);
    const count = await prisma.pushSubscription.count({
      where: { endpoint },
    });
    expect(count).toBe(1);

    const del = await api("DELETE", "/push/subscriptions", driverToken, {
      endpoint,
    });
    expect(del.status).toBe(200);
    expect(
      await prisma.pushSubscription.findUnique({ where: { endpoint } }),
    ).toBeNull();
  });

  it("requiere autenticación", async () => {
    const res = await api("POST", "/push/subscriptions", undefined, {
      endpoint,
      keys: { p256dh: "x", auth: "y" },
    });
    expect(res.status).toBe(401);
  });

  it("despachar una ruta con push sin configurar no falla (no-op)", async () => {
    // Pedido + plan mínimo para llegar al despacho (el hook de push corre
    // dentro de /routes/:id/dispatch).
    const order = await api("POST", "/orders", adminToken, {
      customerName: "Cliente Push",
      customerPhone: "+573111111199",
      addressRaw: "Cl 100 # 19-61",
      lat: 4.6864,
      lng: -74.0521,
    });
    expect(order.status).toBe(201);
    const vehicle = await api("POST", "/vehicles", adminToken, {
      plate: "PSH01A",
      type: "RAP_MOVE_LIGHT",
      capacityKg: 20,
      isElectric: true,
      batteryKwh: 4,
      nominalRangeKm: 90,
    });
    expect(vehicle.status).toBe(201);

    const plan = await api("POST", "/optimization/plans", adminToken, {
      date: new Date().toISOString().slice(0, 10),
      orderIds: [order.body.id],
      vehicleIds: [vehicle.body.id],
      depot: { lat: 4.6534, lng: -74.0837 },
    });
    expect(plan.status).toBe(201);
    const routeId = plan.body.routes[0].id;

    const drivers = await api("GET", "/drivers", adminToken);
    const driverId = drivers.body[0].id;
    const dispatch = await api(
      "POST",
      `/routes/${routeId}/dispatch`,
      adminToken,
      { driverId },
    );
    expect(dispatch.status).toBe(200);
  });
});
