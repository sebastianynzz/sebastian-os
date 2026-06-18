import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Zonas de entrega (D5): CRUD de polígonos, validación de conductores del
 * tenant en driverIds, mutaciones solo ADMIN y aislamiento (el rol CLIENT del
 * portal no puede mutar). Tenant-scoped.
 */
const runId = Date.now();
const adminEmail = `zones+${runId}@test.moveos.co`;
const portalEmail = `zonescli+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;
let portalToken: string;
let driverId: string;

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

const polygon = {
  points: [
    { lat: 4.6, lng: -74.1 },
    { lat: 4.7, lng: -74.1 },
    { lat: 4.7, lng: -74.0 },
    { lat: 4.6, lng: -74.0 },
  ],
};

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const reg = await api("POST", "/auth/register", undefined, {
    tenantName: "Zones Co",
    adminName: "Admin",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = reg.body.tenant.id;
  adminToken = reg.body.token;

  const driver = await api("POST", "/drivers", adminToken, {
    name: "Conductor Zona",
    phone: "+573000000088",
    documentId: `88${runId}`.slice(0, 12),
  });
  driverId = driver.body.id;

  const client = await api("POST", "/clients", adminToken, {
    name: "Comercio Zona",
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

describe("Zonas de entrega (D5)", () => {
  let zoneId: string;

  it("crea una zona con polígono y conductor asignado", async () => {
    const res = await api("POST", "/zones", adminToken, {
      name: "Centro",
      color: "#CFDD80",
      geometry: polygon,
      driverIds: [driverId],
    });
    expect(res.status).toBe(201);
    expect(res.body.driverIds).toEqual([driverId]);
    expect(res.body.geometry.points.length).toBe(4);
    zoneId = res.body.id;

    const list = await api("GET", "/zones", adminToken);
    expect(list.body.some((z: { id: string }) => z.id === zoneId)).toBe(true);
  });

  it("rechaza un polígono con menos de 3 vértices (400)", async () => {
    const res = await api("POST", "/zones", adminToken, {
      name: "Mala",
      geometry: { points: [{ lat: 4.6, lng: -74.1 }, { lat: 4.7, lng: -74.1 }] },
    });
    expect(res.status).toBe(400);
  });

  it("rechaza un conductor que no pertenece al tenant (400)", async () => {
    const res = await api("POST", "/zones", adminToken, {
      name: "Otra",
      geometry: polygon,
      driverIds: ["driver-inexistente"],
    });
    expect(res.status).toBe(400);
  });

  it("edita el nombre y el color de la zona", async () => {
    const res = await api("PATCH", `/zones/${zoneId}`, adminToken, {
      name: "Centro Ampliado",
      color: "#233955",
    });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Centro Ampliado");
    expect(res.body.color).toBe("#233955");
  });

  it("el rol CLIENT del portal no puede crear zonas (403)", async () => {
    const res = await api("POST", "/zones", portalToken, {
      name: "X",
      geometry: polygon,
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CLIENT_PORTAL_ONLY");
  });

  it("elimina la zona (204) y desaparece del listado", async () => {
    const del = await api("DELETE", `/zones/${zoneId}`, adminToken);
    expect(del.status).toBe(204);
    const list = await api("GET", "/zones", adminToken);
    expect(list.body.some((z: { id: string }) => z.id === zoneId)).toBe(false);
  });

  it("404 al editar/borrar una zona inexistente", async () => {
    expect((await api("PATCH", "/zones/nope", adminToken, { name: "Z" })).status).toBe(404);
    expect((await api("DELETE", "/zones/nope", adminToken)).status).toBe(404);
  });
});

describe("cobertura por zona al crear pedido (D5.3)", () => {
  beforeAll(async () => {
    // Zona única que cubre lat 4.60–4.70, lng -74.10 … -74.00.
    await api("POST", "/zones", adminToken, {
      name: "Cobertura",
      geometry: { points: polygon.points },
    });
  });

  async function eventTypes(orderId: string): Promise<string[]> {
    const evs = await prisma.orderEvent.findMany({
      where: { orderId },
      select: { type: true },
    });
    return evs.map((e) => e.type);
  }

  it("un destino dentro de una zona no marca fuera de cobertura", async () => {
    const order = await api("POST", "/orders", adminToken, {
      customerName: "Dentro",
      customerPhone: "+573111111130",
      addressRaw: "Centro",
      lat: 4.65,
      lng: -74.05,
    });
    expect(await eventTypes(order.body.id)).not.toContain("OUT_OF_ZONE");
  });

  it("un destino fuera de toda zona queda registrado (OUT_OF_ZONE)", async () => {
    const order = await api("POST", "/orders", adminToken, {
      customerName: "Fuera",
      customerPhone: "+573111111131",
      addressRaw: "Lejos",
      lat: 4.8,
      lng: -74.05,
    });
    expect(await eventTypes(order.body.id)).toContain("OUT_OF_ZONE");
  });

  it("la validación de dirección del portal reporta cobertura", async () => {
    const res = await api("POST", "/portal/address/validate", portalToken, {
      addressRaw: "Cra 13 # 54-20, Bogotá",
    });
    expect(res.status).toBe(200);
    expect(res.body.hasZones).toBe(true);
    expect(typeof res.body.serviceable).toBe("boolean");
    expect(Array.isArray(res.body.coverageZones)).toBe(true);
  });
});

describe("conductores sugeridos por zona al despachar (D5)", () => {
  let routeId: string;

  beforeAll(async () => {
    await api("POST", "/zones", adminToken, {
      name: "Zona del conductor",
      geometry: polygon,
      driverIds: [driverId],
    });
    const vehicle = await api("POST", "/vehicles", adminToken, {
      plate: "ZON1Z9",
      type: "IONAX",
      capacityKg: 600,
      isElectric: true,
      nominalRangeKm: 200,
    });
    const order = await api("POST", "/orders", adminToken, {
      customerName: "En zona",
      customerPhone: "+573111111140",
      addressRaw: "Centro",
      lat: 4.65,
      lng: -74.05,
    });
    const plan = await api("POST", "/optimization/plans", adminToken, {
      date: "2026-06-14", // domingo: sin pico y placa
      depot: { lat: 4.6486, lng: -74.0628 },
      orderIds: [order.body.id],
      vehicleIds: [vehicle.body.id],
    });
    routeId = plan.body.routes[0].id;
  });

  it("sugiere el conductor asignado a la zona que cubre las paradas", async () => {
    const res = await api("GET", `/routes/${routeId}/suggested-drivers`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.drivers.some((d: { id: string }) => d.id === driverId)).toBe(true);
  });

  it("404 para una ruta inexistente", async () => {
    const res = await api("GET", "/routes/nope/suggested-drivers", adminToken);
    expect(res.status).toBe(404);
  });
});
