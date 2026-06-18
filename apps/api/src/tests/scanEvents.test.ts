import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Escaneo de paquetes (Tier 2 §11): cadena de custodia depósito → puerta.
 * Verifica la verificación del manifiesto al cargar (LOAD), la persistencia de
 * ScanEvent en el escaneo de parada (DELIVER) y el manifiesto de la ruta.
 * El conductor solo escanea su propia ruta; tenant-scoped.
 */
const runId = Date.now();
const adminEmail = `scan+${runId}@test.moveos.co`;
const driverEmail = `scandrv+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;
let driverToken: string;
let routeId: string;
let orderId: string;
let trackingNumber: string;

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

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  const reg = await api("POST", "/auth/register", undefined, {
    tenantName: "Scan Co",
    adminName: "Admin",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = reg.body!.tenant.id;
  adminToken = reg.body!.token;

  const vehicle = await api("POST", "/vehicles", adminToken, {
    plate: "SCN1Z9",
    type: "IONAX",
    capacityKg: 600,
    isElectric: true,
    nominalRangeKm: 200,
  });
  const driver = await api("POST", "/drivers", adminToken, {
    name: "Conductor Scan",
    phone: "+573000000066",
    documentId: `66${runId}`.slice(0, 12),
    email: driverEmail,
    password: "moveos123",
  });
  const order = await api("POST", "/orders", adminToken, {
    customerName: "Destino Scan",
    customerPhone: "+573111111180",
    addressRaw: "Cra 13 # 54-20",
    lat: 4.6416,
    lng: -74.0639,
  });
  orderId = order.body.id;
  trackingNumber = order.body.trackingNumber;

  const plan = await api("POST", "/optimization/plans", adminToken, {
    date: "2026-06-14", // domingo: sin pico y placa
    depot: { lat: 4.6486, lng: -74.0628 },
    orderIds: [orderId],
    vehicleIds: [vehicle.body.id],
  });
  routeId = plan.body.routes[0].id;
  await api("POST", `/routes/${routeId}/dispatch`, adminToken, {
    driverId: driver.body.id,
  });
  driverToken = (
    await api("POST", "/auth/login", undefined, {
      email: driverEmail,
      password: "moveos123",
    })
  ).body.token;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("Escaneo de paquetes / cadena de custodia (Tier 2 §11)", () => {
  it("el manifiesto arranca con todo sin cargar", async () => {
    const res = await api("GET", `/routes/${routeId}/manifest`, driverToken);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.loaded).toBe(0);
    expect(res.body.orders[0]).toMatchObject({ orderId, loaded: false });
  });

  it("escaneo de carga (LOAD) coincidente marca el bulto cargado", async () => {
    const res = await api("POST", `/routes/${routeId}/load-scan`, driverToken, {
      code: trackingNumber,
    });
    expect(res.status).toBe(200);
    expect(res.body.match).toBe(true);
    expect(res.body.orderId).toBe(orderId);

    const manifest = await api("GET", `/routes/${routeId}/manifest`, driverToken);
    expect(manifest.body.loaded).toBe(1);
    expect(manifest.body.orders[0].loaded).toBe(true);

    // Persistió el ScanEvent (LOAD, matched) + un evento LOADED en la bitácora.
    const scans = await prisma.scanEvent.count({
      where: { routeId, type: "LOAD", matched: true },
    });
    expect(scans).toBe(1);
    const loaded = await prisma.orderEvent.count({
      where: { orderId, type: "LOADED" },
    });
    expect(loaded).toBe(1);
  });

  it("re-escanear el mismo bulto no duplica el evento LOADED", async () => {
    await api("POST", `/routes/${routeId}/load-scan`, driverToken, {
      code: trackingNumber,
    });
    const loaded = await prisma.orderEvent.count({
      where: { orderId, type: "LOADED" },
    });
    expect(loaded).toBe(1);
  });

  it("un código que no es de la ruta no coincide (sin orderId)", async () => {
    const res = await api("POST", `/routes/${routeId}/load-scan`, driverToken, {
      code: "MV-NOEXISTE",
    });
    expect(res.body.match).toBe(false);
    expect(res.body.orderId).toBeNull();
    const mismatches = await prisma.scanEvent.count({
      where: { routeId, type: "LOAD", matched: false },
    });
    expect(mismatches).toBe(1);
  });

  it("el escaneo en la parada de entrega persiste un ScanEvent DELIVER", async () => {
    const route = await api("GET", `/routes/${routeId}`, adminToken);
    const stop = route.body.stops.find((s: any) => s.kind === "DELIVERY");
    const res = await api("POST", `/routes/stops/${stop.id}/scan`, driverToken, {
      code: trackingNumber,
    });
    expect(res.body.match).toBe(true);
    const delivers = await prisma.scanEvent.count({
      where: { orderId, type: "DELIVER", matched: true },
    });
    expect(delivers).toBe(1);
  });
});
