import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Conductores: vencimiento de licencia (cumplimiento) y disponibilidad
 * (ACTIVE/INACTIVE). El PATCH va acotado al tenant: un operador ajeno no puede
 * tocar conductores que no son suyos.
 */

const runId = Date.now();
const adminEmail = `drv-admin+${runId}@test.moveos.co`;
const otherEmail = `drv-other+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let otherTenantId: string;
let adminToken: string;
let otherToken: string;
let driverId = "";

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

  const a = await api("POST", "/auth/register", undefined, {
    tenantName: "Test Conductores A",
    adminName: "Admin A",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = a.body.tenant.id;
  adminToken = a.body.token;

  const b = await api("POST", "/auth/register", undefined, {
    tenantName: "Test Conductores B",
    adminName: "Admin B",
    city: "Bogotá",
    email: otherEmail,
    password: "moveos123",
  });
  otherTenantId = b.body.tenant.id;
  otherToken = b.body.token;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  if (otherTenantId) await prisma.tenant.delete({ where: { id: otherTenantId } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("conductores — licencia + disponibilidad", () => {
  it("crea un conductor con vencimiento de licencia", async () => {
    const license = new Date("2026-12-31").toISOString();
    const res = await api("POST", "/drivers", adminToken, {
      name: "Mensajero Uno",
      phone: "+573001112233",
      documentId: "100200300",
      licenseExpiresAt: license,
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("ACTIVE");
    expect(new Date(res.body.licenseExpiresAt).toISOString()).toBe(license);
    driverId = res.body.id;

    const list = await api("GET", "/drivers", adminToken);
    const mine = list.body.find((d: { id: string }) => d.id === driverId);
    expect(mine.licenseExpiresAt).toBeTruthy();
  });

  it("cambia la disponibilidad a INACTIVE", async () => {
    const res = await api("PATCH", `/drivers/${driverId}`, adminToken, {
      status: "INACTIVE",
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("INACTIVE");
  });

  it("limpia el vencimiento de licencia con null", async () => {
    const res = await api("PATCH", `/drivers/${driverId}`, adminToken, {
      licenseExpiresAt: null,
    });
    expect(res.status).toBe(200);
    expect(res.body.licenseExpiresAt).toBeNull();
  });

  it("rechaza un PATCH vacío (nada que actualizar)", async () => {
    const res = await api("PATCH", `/drivers/${driverId}`, adminToken, {});
    expect(res.status).toBe(400);
  });

  it("AISLAMIENTO: otro tenant no puede actualizar el conductor (404)", async () => {
    const res = await api("PATCH", `/drivers/${driverId}`, otherToken, {
      status: "ACTIVE",
    });
    expect(res.status).toBe(404);
  });
});

describe("conductores — depósito base (multi-depot D4)", () => {
  it("asigna un depósito del propio tenant al crear", async () => {
    const depot = await api("POST", "/depots", adminToken, {
      name: "Depósito A",
      lat: 4.65,
      lng: -74.06,
    });
    expect(depot.status).toBe(201);
    const res = await api("POST", "/drivers", adminToken, {
      name: "Conductor con depósito",
      phone: "+573000000111",
      documentId: "depo-aaa",
      depotId: depot.body.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.depotId).toBe(depot.body.id);
  });

  it("AISLAMIENTO: rechaza un depósito de otro tenant (400)", async () => {
    const depotB = await api("POST", "/depots", otherToken, {
      name: "Depósito B",
      lat: 6.2,
      lng: -75.5,
    });
    const res = await api("POST", "/drivers", adminToken, {
      name: "Conductor depósito ajeno",
      phone: "+573000000112",
      documentId: "depo-bbb",
      depotId: depotB.body.id,
    });
    expect(res.status).toBe(400);
  });
});
