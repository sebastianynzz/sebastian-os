import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Flujo pickup→delivery: el conductor recoge en el origen del cliente y luego
 * entrega al destinatario. Verifica que el optimizador produce 2 paradas
 * (PICKUP antes que DELIVERY) y que el ciclo del pedido las distingue.
 */

const runId = Date.now();
const adminEmail = `pk-admin+${runId}@test.moveos.co`;
const driverEmail = `pk-driver+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;
let driverToken: string;
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

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const reg = await api("POST", "/auth/register", undefined, {
    tenantName: "Test Pickup",
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

describe("flujo pickup→delivery", () => {
  let orderId: string;
  let routeId: string;
  let pickupStopId: string;
  let deliveryStopId: string;

  it("crea vehículo, conductor y un pedido con recogida en origen", async () => {
    const moto = await api("POST", "/vehicles", adminToken, {
      plate: "PKM12A",
      type: "RAP_MOVE_LIGHT",
      capacityKg: 20,
    });
    expect(moto.status).toBe(201);

    const driver = await api("POST", "/drivers", adminToken, {
      name: "Conductor Pickup",
      phone: "+573000000099",
      documentId: "900900900",
      email: driverEmail,
      password: "moveos123",
    });
    expect(driver.status).toBe(201);
    driverId = driver.body.id;

    // Pedido con recogida (tienda del cliente) y entrega (destinatario).
    const order = await api("POST", "/orders", adminToken, {
      customerName: "Destinatario Uno",
      customerPhone: "+573111111111",
      addressRaw: "Cra 13 # 54-20",
      lat: 4.6416,
      lng: -74.0639,
      pickupAddressRaw: "Bodega Cliente, Cl 80 # 20-10",
      pickupLat: 4.66,
      pickupLng: -74.06,
    });
    expect(order.status).toBe(201);
    expect(order.body.pickupLat).toBeCloseTo(4.66, 2);
    orderId = order.body.id;
  });

  it("planifica y genera una parada de recogida ANTES de la entrega", async () => {
    const vehicles = await api("GET", "/vehicles", adminToken);
    const plan = await api("POST", "/optimization/plans", adminToken, {
      date: "2026-06-14", // domingo: sin pico y placa
      depot: { lat: 4.6486, lng: -74.0628 },
      orderIds: [orderId],
      vehicleIds: vehicles.body.map((v: { id: string }) => v.id),
    });
    expect(plan.status).toBe(201);
    routeId = plan.body.routes[0].id;

    const route = await api("GET", `/routes/${routeId}`, adminToken);
    const stops = route.body.stops;
    expect(stops).toHaveLength(2);
    expect(stops.map((s: { kind: string }) => s.kind)).toEqual(["PICKUP", "DELIVERY"]);
    pickupStopId = stops[0].id;
    deliveryStopId = stops[1].id;
  });

  it("el conductor recoge: el pedido queda recogido pero NO entregado", async () => {
    await api("POST", `/routes/${routeId}/dispatch`, adminToken, { driverId });
    const login = await api("POST", "/auth/login", undefined, {
      email: driverEmail,
      password: "moveos123",
    });
    driverToken = login.body.token;
    await api("POST", `/routes/${routeId}/start`, driverToken);

    const pickup = await api("POST", `/routes/stops/${pickupStopId}/complete`, driverToken, {
      types: ["GEOFENCE"],
      lat: 4.66,
      lng: -74.06,
    });
    expect(pickup.status).toBe(200);
    expect(pickup.body.kind).toBe("PICKUP");

    const order = await api("GET", `/orders/${orderId}`, adminToken);
    expect(order.body.status).toBe("IN_TRANSIT"); // recogido, aún no entregado
    const events = order.body.events.map((e: { type: string }) => e.type);
    expect(events).toContain("PICKED_UP");
    expect(events).not.toContain("DELIVERED");
  });

  it("el conductor entrega: el pedido queda DELIVERED con su bitácora completa", async () => {
    const deliver = await api("POST", `/routes/stops/${deliveryStopId}/complete`, driverToken, {
      types: ["GEOFENCE"],
      receivedBy: "Destinatario Uno",
      lat: 4.6416,
      lng: -74.0639,
    });
    expect(deliver.status).toBe(200);
    expect(deliver.body.kind).toBe("DELIVERY");
    expect(deliver.body.geofenceOk).toBe(true);

    const order = await api("GET", `/orders/${orderId}`, adminToken);
    expect(order.body.status).toBe("DELIVERED");
    const events = order.body.events.map((e: { type: string }) => e.type);
    for (const expected of ["CREATED", "ASSIGNED", "DISPATCHED", "IN_TRANSIT", "PICKED_UP", "DELIVERED"]) {
      expect(events).toContain(expected);
    }
    // La recogida precede a la entrega en la bitácora.
    expect(events.indexOf("PICKED_UP")).toBeLessThan(events.indexOf("DELIVERED"));
  });
});
