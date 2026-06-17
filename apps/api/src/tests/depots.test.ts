import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Depósitos / multi-depot (D4): CRUD del catálogo de depósitos, invariante de
 * un único principal por tenant (al crear/editar como principal se desmarca el
 * resto; al borrar el principal se promueve otro), mutaciones solo ADMIN y
 * aislamiento (el rol CLIENT del portal no puede mutar). Tenant-scoped.
 */
const runId = Date.now();
const adminEmail = `depots+${runId}@test.moveos.co`;
const portalEmail = `depotscli+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;
let portalToken: string;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function api(
  method: "GET" | "POST" | "PATCH" | "DELETE",
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
    tenantName: "Depots Co",
    adminName: "Admin",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = reg.body.tenant.id;
  adminToken = reg.body.token;

  const client = await api("POST", "/clients", adminToken, {
    name: "Comercio Depot",
    notifyChannel: "IN_APP",
  });
  await api("POST", `/clients/${client.body.id}/portal-access`, adminToken, {
    email: portalEmail,
    password: "moveos123",
  });
  const login = await api("POST", "/auth/login", undefined, {
    email: portalEmail,
    password: "moveos123",
  });
  portalToken = login.body.token;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("Depósitos / multi-depot (D4)", () => {
  let mainId: string;
  let secondId: string;

  it("el primer depósito queda como principal automáticamente", async () => {
    const res = await api("POST", "/depots", adminToken, {
      name: "Central",
      address: "Cra 30 # 1-50",
      lat: 4.6486,
      lng: -74.0628,
    });
    expect(res.status).toBe(201);
    expect(res.body.isMain).toBe(true);
    mainId = res.body.id;
  });

  it("un segundo depósito no principal coexiste; el listado pone el principal primero", async () => {
    const res = await api("POST", "/depots", adminToken, {
      name: "Norte",
      lat: 4.71,
      lng: -74.07,
    });
    expect(res.status).toBe(201);
    expect(res.body.isMain).toBe(false);
    secondId = res.body.id;

    const list = await api("GET", "/depots", adminToken);
    expect(list.body.length).toBe(2);
    expect(list.body[0].id).toBe(mainId);
  });

  it("marcar otro como principal desmarca al anterior (uno por tenant)", async () => {
    const res = await api("PATCH", `/depots/${secondId}`, adminToken, { isMain: true });
    expect(res.status).toBe(200);
    expect(res.body.isMain).toBe(true);

    const mains = await prisma.depot.findMany({ where: { tenantId, isMain: true } });
    expect(mains.length).toBe(1);
    expect(mains[0]!.id).toBe(secondId);
  });

  it("el rol CLIENT del portal no puede crear depósitos (403)", async () => {
    const denied = await api("POST", "/depots", portalToken, {
      name: "X",
      lat: 4.6,
      lng: -74.0,
    });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("CLIENT_PORTAL_ONLY");
  });

  it("borrar el principal promueve a otro depósito", async () => {
    const del = await api("DELETE", `/depots/${secondId}`, adminToken);
    expect(del.status).toBe(204);
    const mains = await prisma.depot.findMany({ where: { tenantId, isMain: true } });
    expect(mains.length).toBe(1);
    expect(mains[0]!.id).toBe(mainId);
  });

  it("404 al editar/borrar un depósito inexistente", async () => {
    expect((await api("PATCH", "/depots/nope", adminToken, { name: "Z" })).status).toBe(404);
    expect((await api("DELETE", "/depots/nope", adminToken)).status).toBe(404);
  });
});

describe("planificación con depósito (D4)", () => {
  it("la ruta queda enlazada al depósito y sus coordenadas mandan", async () => {
    await prisma.moduleEntitlement.upsert({
      where: { tenantId_moduleKey: { tenantId, moduleKey: "ROUTE_OPTIMIZATION" } },
      create: { tenantId, moduleKey: "ROUTE_OPTIMIZATION", enabled: true },
      update: { enabled: true },
    });
    const depot = await api("POST", "/depots", adminToken, {
      name: "Plan Depot",
      lat: 4.701,
      lng: -74.071,
    });
    const vehicle = await api("POST", "/vehicles", adminToken, {
      plate: "DPT1Z9",
      type: "IONAX",
      capacityKg: 600,
      isElectric: true,
      nominalRangeKm: 200,
    });
    const order = await api("POST", "/orders", adminToken, {
      customerName: "Destino Depot",
      customerPhone: "+573111111120",
      addressRaw: "Cra 13 # 54-20",
      lat: 4.6416,
      lng: -74.0639,
    });

    const plan = await api("POST", "/optimization/plans", adminToken, {
      date: "2026-06-20",
      // Coordenadas distintas a propósito: el depotId debe imponerse sobre estas.
      depot: { lat: 4.6, lng: -74.1 },
      depotId: depot.body.id,
      orderIds: [order.body.id],
      vehicleIds: [vehicle.body.id],
    });
    expect(plan.status).toBe(201);
    expect(plan.body.routes.length).toBeGreaterThan(0);

    const route = await prisma.route.findUnique({
      where: { id: plan.body.routes[0].id },
      select: { depotId: true, depotLat: true, depotLng: true },
    });
    expect(route?.depotId).toBe(depot.body.id);
    expect(route?.depotLat).toBeCloseTo(4.701);
    expect(route?.depotLng).toBeCloseTo(-74.071);
  });

  it("rechaza un depotId que no pertenece al tenant (400)", async () => {
    const vehicle = await api("POST", "/vehicles", adminToken, {
      plate: "DPT2Z9",
      type: "IONAX",
      capacityKg: 600,
      isElectric: true,
      nominalRangeKm: 200,
    });
    const order = await api("POST", "/orders", adminToken, {
      customerName: "Destino Depot 2",
      customerPhone: "+573111111121",
      addressRaw: "Cra 7 # 40-10",
      lat: 4.63,
      lng: -74.06,
    });
    const bad = await api("POST", "/optimization/plans", adminToken, {
      date: "2026-06-20",
      depot: { lat: 4.6, lng: -74.1 },
      depotId: "depot-inexistente",
      orderIds: [order.body.id],
      vehicleIds: [vehicle.body.id],
    });
    expect(bad.status).toBe(400);
  });
});
