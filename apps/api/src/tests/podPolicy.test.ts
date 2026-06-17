import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Política POD configurable por cliente: el comercio puede EXIGIR foto y/o
 * nombre de quien recibe para aceptar una entrega. La fuente de verdad es el
 * servidor: /routes/stops/:id/complete rechaza la entrega que no trae las
 * pruebas exigidas (no se puede saltar ni reproducido desde la cola offline).
 */

const runId = Date.now();
const adminEmail = `pod+${runId}@test.moveos.co`;
const driverEmail = `poddrv+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;
let driverToken: string;
let stopId: string;
let orderLat: number;
let orderLng: number;

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
    tenantName: "POD Policy Co",
    adminName: "Admin POD",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = reg.body.tenant.id;
  adminToken = reg.body.token;

  // Comercio cliente que EXIGE foto y nombre de quien recibe.
  const client = await api("POST", "/clients", adminToken, {
    name: "Tienda Exigente",
    notifyChannel: "IN_APP",
    podRequired: ["PHOTO", "RECEIVER_NAME"],
  });
  const clientId = client.body.id;

  const vehicle = await api("POST", "/vehicles", adminToken, {
    plate: "POD99Z",
    type: "IONAX",
    capacityKg: 600,
    isElectric: true,
    batteryKwh: 42,
    nominalRangeKm: 200,
  });

  const driver = await api("POST", "/drivers", adminToken, {
    name: "Conductor POD",
    phone: "+573000000099",
    documentId: `99${runId}`.slice(0, 12),
    email: driverEmail,
    password: "moveos123",
  });

  const order = await api("POST", "/orders", adminToken, {
    clientId,
    customerName: "Destino POD",
    customerPhone: "+573111111199",
    addressRaw: "Cra 13 # 54-20",
    lat: 4.6416,
    lng: -74.0639,
  });
  orderLat = order.body.lat;
  orderLng = order.body.lng;

  const plan = await api("POST", "/optimization/plans", adminToken, {
    date: "2026-06-14",
    depot: { lat: 4.6486, lng: -74.0628 },
    orderIds: [order.body.id],
    vehicleIds: [vehicle.body.id],
  });
  const routeId = plan.body.routes[0].id;
  const route = await api("GET", `/routes/${routeId}`, adminToken);
  stopId = route.body.stops[0].id;

  await api("POST", `/routes/${routeId}/dispatch`, adminToken, {
    driverId: driver.body.id,
  });
  const login = await api("POST", "/auth/login", undefined, {
    email: driverEmail,
    password: "moveos123",
  });
  driverToken = login.body.token;
  await api("POST", `/routes/${routeId}/start`, driverToken);
});

afterAll(async () => {
  if (tenantId) {
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  }
  await app.close();
  await prisma.$disconnect();
});

describe("política POD configurable por cliente (servidor = fuente de verdad)", () => {
  it("rechaza la entrega sin la foto exigida (422), aunque el esquema POD sea válido", async () => {
    const res = await api("POST", `/routes/stops/${stopId}/complete`, driverToken, {
      types: ["GEOFENCE"],
      receivedBy: "Ana",
      lat: orderLat,
      lng: orderLng,
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain("foto");
  });

  it("rechaza la entrega sin el nombre de quien recibe (422)", async () => {
    const res = await api("POST", `/routes/stops/${stopId}/complete`, driverToken, {
      types: ["PHOTO", "GEOFENCE"],
      photoUrl: "https://files.example.com/pod/abc.jpg",
      lat: orderLat,
      lng: orderLng,
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain("recibe");
  });

  it("acepta la entrega cuando trae todas las pruebas exigidas (200)", async () => {
    const res = await api("POST", `/routes/stops/${stopId}/complete`, driverToken, {
      types: ["PHOTO", "GEOFENCE"],
      photoUrl: "https://files.example.com/pod/abc.jpg",
      receivedBy: "Ana",
      lat: orderLat,
      lng: orderLng,
    });
    expect(res.status).toBe(200);
    expect(res.body.geofenceOk).toBe(true);
  });
});
