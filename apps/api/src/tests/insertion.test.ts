import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { buildTravelModel } from "../services/routing.js";

/**
 * Inserción dinámica (express) en rutas existentes + modelo de viaje OSRM
 * (con servidor mock) y su fallback a haversine.
 */

const runId = Date.now();
const adminEmail = `ins-admin+${runId}@test.moveos.co`;
const driverEmail = `ins-driver+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;
let driverId: string;

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

async function createOrder(name: string, lat: number, lng: number, weightKg = 1) {
  const res = await api("POST", "/orders", adminToken, {
    customerName: name,
    customerPhone: "+573110000000",
    addressRaw: `Dir ${name}`,
    lat,
    lng,
    weightKg,
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const reg = await api("POST", "/auth/register", undefined, {
    tenantName: "Test Insertion",
    adminName: "Admin",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = reg.body.tenant.id;
  adminToken = reg.body.token;

  await api("POST", "/vehicles", adminToken, {
    plate: "INS12A",
    type: "MOTO",
    capacityKg: 10,
  });
  const driver = await api("POST", "/drivers", adminToken, {
    name: "Conductor Insert",
    phone: "+573000000777",
    documentId: "777888999",
    email: driverEmail,
    password: "moveos123",
  });
  driverId = driver.body.id;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("inserción express en ruta existente", () => {
  let routeId: string;

  it("planifica una ruta base con 2 pedidos", async () => {
    const north = await createOrder("Norte", 4.7, -74.06, 2);
    const south = await createOrder("Sur", 4.6, -74.06, 2);
    const vehicles = await api("GET", "/vehicles", adminToken);
    const plan = await api("POST", "/optimization/plans", adminToken, {
      date: "2026-06-14",
      depot: { lat: 4.6486, lng: -74.0628 },
      orderIds: [north, south],
      vehicleIds: vehicles.body.map((v: { id: string }) => v.id),
    });
    expect(plan.status).toBe(201);
    expect(plan.body.distanceModel).toBe("haversine"); // sin OSRM_URL
    routeId = plan.body.routes[0].id;
  });

  it("inserta un pedido express en la mejor posición y reordena ETAs", async () => {
    const mid = await createOrder("Medio", 4.65, -74.06, 2);
    const res = await api(
      "POST",
      `/optimization/routes/${routeId}/insert`,
      adminToken,
      { orderId: mid },
    );
    expect(res.status).toBe(201);
    const stops = res.body.route.stops;
    expect(stops).toHaveLength(3);
    // Secuencia contigua y ETAs crecientes.
    expect(stops.map((s: { sequence: number }) => s.sequence)).toEqual([1, 2, 3]);
    const etas = stops.map((s: { etaMin: number }) => s.etaMin);
    expect([...etas].sort((a: number, b: number) => a - b)).toEqual(etas);
    // El pedido insertado quedó asignado y con bitácora de inserción.
    const order = await api("GET", `/orders/${mid}`, adminToken);
    expect(order.body.status).toBe("ASSIGNED");
    const types = order.body.events.map((e: { type: string }) => e.type);
    expect(types).toContain("ASSIGNED");
  });

  it("rechaza con 422 cuando el pedido no cabe (capacidad)", async () => {
    const heavy = await createOrder("Pesado", 4.66, -74.05, 9); // 9 + 6 > 10 kg
    const res = await api(
      "POST",
      `/optimization/routes/${routeId}/insert`,
      adminToken,
      { orderId: heavy },
    );
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("INSERTION_INFEASIBLE");
  });

  it("inserta en ruta EN CURSO sin tocar paradas ya atendidas", async () => {
    // Despachar e iniciar; completar la primera parada.
    await api("POST", `/routes/${routeId}/dispatch`, adminToken, { driverId });
    const login = await api("POST", "/auth/login", undefined, {
      email: driverEmail,
      password: "moveos123",
    });
    const driverToken = login.body.token;
    await api("POST", `/routes/${routeId}/start`, driverToken);

    const route = await api("GET", `/routes/${routeId}`, adminToken);
    const first = route.body.stops[0];
    await api("POST", `/routes/stops/${first.id}/complete`, driverToken, {
      types: ["GEOFENCE"],
      lat: first.order.lat,
      lng: first.order.lng,
    });

    const extra = await createOrder("Extra", 4.64, -74.065, 1);
    const res = await api(
      "POST",
      `/optimization/routes/${routeId}/insert`,
      adminToken,
      { orderId: extra },
    );
    expect(res.status).toBe(201);
    const stops = res.body.route.stops;
    // La parada completada sigue siendo la #1, intacta.
    expect(stops[0].id).toBe(first.id);
    expect(stops[0].status).toBe("COMPLETED");
    // El pedido insertado entra en estado IN_TRANSIT (la ruta ya va en curso).
    const order = await api("GET", `/orders/${extra}`, adminToken);
    expect(order.body.status).toBe("IN_TRANSIT");
  });
});

describe("modelo de viaje OSRM (mock) y fallback", () => {
  let mock: Server;
  let mockUrl: string;

  beforeAll(async () => {
    mock = createServer((req, res) => {
      // Tabla 2x2 con valores artificiales detectables.
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          code: "Ok",
          distances: [
            [0, 5000],
            [5000, 0],
          ],
          durations: [
            [0, 600],
            [600, 0],
          ],
        }),
      );
    });
    await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
    const addr = mock.address();
    mockUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });

  afterAll(() => {
    mock.close();
    delete process.env.OSRM_URL;
  });

  it("usa la matriz OSRM cuando OSRM_URL responde", async () => {
    process.env.OSRM_URL = mockUrl;
    const a = { lat: 4.6, lng: -74.06 };
    const b = { lat: 4.7, lng: -74.06 };
    const built = await buildTravelModel([a, b]);
    expect(built.source).toBe("osrm");
    expect(built.model.distanceKm(a, b)).toBe(5); // 5000 m
    expect(built.model.travelMin(a, b, "CARRO")).toBe(10); // 600 s
    expect(built.model.travelMin(a, b, "MOTO")).toBeCloseTo(8, 5); // ×0.8
  });

  it("cae a haversine si OSRM no responde", async () => {
    process.env.OSRM_URL = "http://127.0.0.1:1"; // puerto cerrado
    const built = await buildTravelModel([
      { lat: 4.6, lng: -74.06 },
      { lat: 4.7, lng: -74.06 },
    ]);
    expect(built.source).toBe("haversine");
  });
});
