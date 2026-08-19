import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * EV-only (HARD CONSTRAINT 1): la flota daleGo es 100% eléctrica. El API es la
 * fuente de verdad — rechaza crear un vehículo de combustión y, si se omite el
 * campo, el vehículo nace eléctrico.
 */

const runId = Date.now();
const adminEmail = `evonly+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;

async function api(method: "POST", url: string, token?: string, body?: unknown) {
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
    tenantName: "EV Only Co",
    adminName: "Admin EV",
    city: "Bogotá",
    email: adminEmail,
    password: "dalego123",
  });
  tenantId = reg.body.tenant.id;
  adminToken = reg.body.token;
});

afterAll(async () => {
  if (tenantId) {
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  }
  await app.close();
  await prisma.$disconnect();
});

describe("EV-only — el API no persiste vehículos de combustión", () => {
  it("rechaza isElectric:false con 400", async () => {
    const res = await api("POST", "/vehicles", adminToken, {
      plate: "ICE01A",
      type: "RAP_MOVE_LIGHT",
      capacityKg: 20,
      isElectric: false,
    });
    expect(res.status).toBe(400);
  });

  it("crea eléctrico por defecto cuando se omite el campo", async () => {
    const res = await api("POST", "/vehicles", adminToken, {
      plate: "EV01A",
      type: "RAP_MOVE_LIGHT",
      capacityKg: 20,
    });
    expect(res.status).toBe(201);
    expect(res.body.isElectric).toBe(true);
  });
});
