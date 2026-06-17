import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Política POD configurable POR TIPO (D2): el despachador define, por tipo de
 * entrega, si la foto/firma son obligatorias; el servidor lo exige en
 * /routes/stops/:id/complete según el tipo elegido por el conductor.
 */
const runId = Date.now();
const adminEmail = `podtype+${runId}@test.moveos.co`;
const driverEmail = `podtypedrv+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;
let driverToken: string;
let stopId: string;
let orderLat: number;
let orderLng: number;

async function api(
  method: "GET" | "POST" | "PATCH" | "PUT",
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
    tenantName: "POD Type Co",
    adminName: "Admin",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = reg.body.tenant.id;
  adminToken = reg.body.token;

  // Cliente SIN exigencias propias: aislamos la política por tipo.
  const client = await api("POST", "/clients", adminToken, {
    name: "Cliente Neutro",
    notifyChannel: "IN_APP",
  });
  const vehicle = await api("POST", "/vehicles", adminToken, {
    plate: "PODT1Z",
    type: "IONAX",
    capacityKg: 600,
    isElectric: true,
    nominalRangeKm: 200,
  });
  const driver = await api("POST", "/drivers", adminToken, {
    name: "Conductor",
    phone: "+573000000077",
    documentId: `77${runId}`.slice(0, 12),
    email: driverEmail,
    password: "moveos123",
  });
  const order = await api("POST", "/orders", adminToken, {
    clientId: client.body.id,
    customerName: "Destino",
    customerPhone: "+573111111177",
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

  // Política del tenant: SAFE_PLACE exige foto; RECIPIENT opcional.
  await api("PATCH", "/controls/pod-policy", adminToken, {
    config: {
      delivery: {
        RECIPIENT: { signature: "OPTIONAL", photo: "OPTIONAL" },
        SAFE_PLACE: { signature: "DISABLED", photo: "MANDATORY" },
      },
      pickup: {},
    },
  });
});

afterAll(async () => {
  if (tenantId) {
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  }
  await app.close();
  await prisma.$disconnect();
});

describe("política POD por tipo (D2)", () => {
  it("GET /controls/pod-policy devuelve la config guardada", async () => {
    const res = await api("GET", "/controls/pod-policy", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.config.delivery.SAFE_PLACE.photo).toBe("MANDATORY");
  });

  it("rechaza SAFE_PLACE sin foto (422 — foto obligatoria por tipo)", async () => {
    const res = await api("POST", `/routes/stops/${stopId}/complete`, driverToken, {
      types: ["GEOFENCE"],
      deliveryType: "SAFE_PLACE",
      lat: orderLat,
      lng: orderLng,
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain("foto");
  });

  it("acepta SAFE_PLACE con foto (200)", async () => {
    const res = await api("POST", `/routes/stops/${stopId}/complete`, driverToken, {
      types: ["PHOTO", "GEOFENCE"],
      deliveryType: "SAFE_PLACE",
      photoUrl: "https://files.example.com/pod/sp.jpg",
      lat: orderLat,
      lng: orderLng,
    });
    expect(res.status).toBe(200);
  });
});
