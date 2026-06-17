import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Vehículos: disponibilidad operativa (ACTIVE | MAINTENANCE | CHARGING). El
 * PATCH va acotado al tenant; el estado inválido se rechaza por el enum Zod.
 */

const runId = Date.now();
const adminEmail = `veh-admin+${runId}@test.moveos.co`;
const otherEmail = `veh-other+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let otherTenantId: string;
let adminToken: string;
let otherToken: string;
let vehicleId = "";

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
    tenantName: "Test Vehículos A",
    adminName: "Admin A",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = a.body.tenant.id;
  adminToken = a.body.token;

  const b = await api("POST", "/auth/register", undefined, {
    tenantName: "Test Vehículos B",
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

describe("vehículos — disponibilidad operativa", () => {
  it("un vehículo nuevo nace ACTIVE por defecto", async () => {
    const res = await api("POST", "/vehicles", adminToken, {
      plate: "VST01A",
      type: "RAP_MOVE_LIGHT",
      capacityKg: 20,
      isElectric: true,
      batteryKwh: 4.864,
      nominalRangeKm: 100,
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("ACTIVE");
    vehicleId = res.body.id;
  });

  it("acepta un estado inicial (CHARGING) al crear", async () => {
    const res = await api("POST", "/vehicles", adminToken, {
      plate: "VST02B",
      type: "IONAX",
      capacityKg: 530,
      isElectric: true,
      batteryKwh: 11.52,
      nominalRangeKm: 130,
      status: "CHARGING",
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("CHARGING");
  });

  it("cambia el estado a MAINTENANCE vía PATCH", async () => {
    const res = await api("PATCH", `/vehicles/${vehicleId}`, adminToken, {
      status: "MAINTENANCE",
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("MAINTENANCE");
  });

  it("rechaza un estado inválido (enum)", async () => {
    const res = await api("PATCH", `/vehicles/${vehicleId}`, adminToken, {
      status: "FLYING",
    });
    expect(res.status).toBe(400);
  });

  it("AISLAMIENTO: otro tenant no puede actualizar el vehículo (404)", async () => {
    const res = await api("PATCH", `/vehicles/${vehicleId}`, otherToken, {
      status: "ACTIVE",
    });
    expect(res.status).toBe(404);
  });
});
