import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Privacidad del rastreo público (Tier 2, B2B): /controls/tracking fija el nivel
 * (ETA_ONLY | ETA_POSITION | FULL) y la página pública /track/:token expone solo
 * lo permitido — sin ubicación del conductor salvo en FULL. Mutación solo ADMIN.
 */
const runId = Date.now();
const adminEmail = `track+${runId}@test.moveos.co`;
const portalEmail = `trackcli+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;
let portalToken: string;
let trackingToken: string;

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
    tenantName: "Track Co",
    adminName: "Admin",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = reg.body.tenant.id;
  adminToken = reg.body.token;

  const client = await api("POST", "/clients", adminToken, {
    name: "Comercio Track",
    notifyChannel: "IN_APP",
  });
  await api("POST", `/clients/${client.body.id}/portal-access`, adminToken, {
    email: portalEmail,
    password: "moveos123",
  });
  portalToken = (
    await api("POST", "/auth/login", undefined, {
      email: portalEmail,
      password: "moveos123",
    })
  ).body.token;

  const vehicle = await api("POST", "/vehicles", adminToken, {
    plate: "TRK1Z9",
    type: "IONAX",
    capacityKg: 600,
    isElectric: true,
    nominalRangeKm: 200,
  });
  const driver = await api("POST", "/drivers", adminToken, {
    name: "Conductor Track",
    phone: "+573000000099",
    documentId: `99${runId}`.slice(0, 12),
  });
  const order = await api("POST", "/orders", adminToken, {
    customerName: "Destino Track",
    customerPhone: "+573111111160",
    addressRaw: "Cra 13 # 54-20",
    lat: 4.6416,
    lng: -74.0639,
  });
  trackingToken = (
    await prisma.order.findUniqueOrThrow({
      where: { id: order.body.id },
      select: { trackingToken: true },
    })
  ).trackingToken!;

  // Fixture en curso: ruta + parada de entrega + ping, pedido IN_TRANSIT.
  const route = await prisma.route.create({
    data: {
      tenantId,
      date: "2026-06-23",
      vehicleId: vehicle.body.id,
      driverId: driver.body.id,
      depotLat: 4.6486,
      depotLng: -74.0628,
      departureMin: 480,
      totalDistanceKm: 5,
      totalDurationMin: 30,
      warnings: [],
    },
  });
  await prisma.routeStop.create({
    data: { routeId: route.id, orderId: order.body.id, kind: "DELIVERY", sequence: 1, etaMin: 20, status: "PENDING" },
  });
  await prisma.order.update({ where: { id: order.body.id }, data: { status: "IN_TRANSIT" } });
  await prisma.telemetryPing.create({
    data: { tenantId, driverId: driver.body.id, lat: 4.62, lng: -74.05, recordedAt: new Date() },
  });
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

async function setTier(tier: string) {
  const res = await api("PATCH", "/controls/tracking", adminToken, { trackingTier: tier });
  expect(res.status).toBe(200);
}

describe("Privacidad del rastreo público (Tier 2)", () => {
  it("/controls/tracking arranca en FULL", async () => {
    const res = await api("GET", "/controls/tracking", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.trackingTier).toBe("FULL");
  });

  it("FULL expone posición en cola y ubicación del conductor", async () => {
    await setTier("FULL");
    const res = await api("GET", `/track/${trackingToken}`);
    expect(res.body.trackingTier).toBe("FULL");
    expect(res.body.queuePosition).toEqual({ position: 1, totalPending: 1 });
    expect(res.body.driverPosition).not.toBeNull();
    expect(res.body.driverPosition.lat).toBeCloseTo(4.62);
  });

  it("ETA_POSITION muestra la cola pero oculta la ubicación", async () => {
    await setTier("ETA_POSITION");
    const res = await api("GET", `/track/${trackingToken}`);
    expect(res.body.trackingTier).toBe("ETA_POSITION");
    expect(res.body.queuePosition).toEqual({ position: 1, totalPending: 1 });
    expect(res.body.driverPosition).toBeNull();
  });

  it("ETA_ONLY oculta cola y ubicación", async () => {
    await setTier("ETA_ONLY");
    const res = await api("GET", `/track/${trackingToken}`);
    expect(res.body.trackingTier).toBe("ETA_ONLY");
    expect(res.body.queuePosition).toBeNull();
    expect(res.body.driverPosition).toBeNull();
    // El historial sigue disponible en todos los niveles.
    expect(Array.isArray(res.body.timeline)).toBe(true);
  });

  it("el rol CLIENT del portal no puede cambiar el nivel (403)", async () => {
    const res = await api("PATCH", "/controls/tracking", portalToken, {
      trackingTier: "FULL",
    });
    expect(res.status).toBe(403);
  });
});
