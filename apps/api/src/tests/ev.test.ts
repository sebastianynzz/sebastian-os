import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { resetModuleEntitlementCache } from "../plugins/entitlements.js";

/**
 * Flota eléctrica como NÚCLEO (restricción dura 1.3: MoveOS es EV-only).
 *
 * Lo más importante: /ev/* responde aunque el entitlement EV_MANAGEMENT esté
 * desactivado en la base — autonomía y carga jamás se gatean. Además el
 * directorio de carga comparte la red pública entre tenants pero aísla los
 * cargadores de depósito de cada uno.
 */

const runId = Date.now();
const adminEmail = `ev-admin+${runId}@test.moveos.co`;
const driverEmail = `ev-driver+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let otherTenantId: string;
let adminToken: string;
let driverToken: string;
let publicStationId: string;

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
    tenantName: "Test EV Core",
    adminName: "Admin EV",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = reg.body.tenant.id;
  adminToken = reg.body.token;

  // Forzar el entitlement EV_MANAGEMENT a false: el núcleo debe ignorarlo.
  await prisma.moduleEntitlement.upsert({
    where: {
      tenantId_moduleKey: { tenantId, moduleKey: "EV_MANAGEMENT" },
    },
    create: { tenantId, moduleKey: "EV_MANAGEMENT", enabled: false },
    update: { enabled: false },
  });
  // Escritura directa con Prisma: el caché TTL de entitlements no se entera.
  resetModuleEntitlementCache();

  // Segundo tenant: su cargador de depósito NO debe filtrarse al primero.
  const other = await prisma.tenant.create({
    data: { name: `Test EV Otro ${runId}` },
  });
  otherTenantId = other.id;

  const [publicStation] = await Promise.all([
    prisma.chargingStation.create({
      data: {
        name: `Pública Cercana ${runId}`,
        network: "Terpel Voltex",
        city: "Bogotá",
        lat: 4.65,
        lng: -74.06,
        connectors: ["CCS"],
        dcFast: true,
      },
    }),
    prisma.chargingStation.create({
      data: {
        name: `Pública Lejana ${runId}`,
        network: "Enel X",
        city: "Bogotá",
        lat: 4.76,
        lng: -74.04,
        connectors: ["TYPE_2"],
      },
    }),
    prisma.chargingStation.create({
      data: {
        tenantId: otherTenantId,
        name: `Depósito Ajeno ${runId}`,
        network: "DEPOSITO",
        city: "Bogotá",
        lat: 4.651,
        lng: -74.061,
        connectors: ["TYPE_2"],
      },
    }),
  ]);
  publicStationId = publicStation.id;
});

afterAll(async () => {
  await prisma.chargingStation
    .deleteMany({ where: { name: { contains: String(runId) } } })
    .catch(() => {});
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  if (otherTenantId) {
    await prisma.tenant.delete({ where: { id: otherTenantId } }).catch(() => {});
  }
  await app.close();
  await prisma.$disconnect();
});

describe("flota eléctrica como núcleo", () => {
  it("/ev/overview responde con el entitlement EV_MANAGEMENT desactivado", async () => {
    const vehicle = await api("POST", "/vehicles", adminToken, {
      plate: "EVT01A",
      type: "RAP_MOVE_LIGHT",
      capacityKg: 15,
      isElectric: true,
      batteryKwh: 4,
      nominalRangeKm: 90,
    });
    expect(vehicle.status).toBe(201);
    await prisma.vehicle.update({
      where: { id: vehicle.body.id },
      data: { socPercent: 50 },
    });

    const overview = await api("GET", "/ev/overview", adminToken);
    expect(overview.status).toBe(200);
    expect(overview.body).toHaveLength(1);
    expect(overview.body[0].usableRangeKm).toBeGreaterThan(0);
    // 50% SoC sobre 90 km nominales: muy por debajo de la nominal.
    expect(overview.body[0].usableRangeKm).toBeLessThan(50);
  });

  it("/ev/range-estimate aplica las condiciones de operación", async () => {
    const overview = await api("GET", "/ev/overview", adminToken);
    const vehicleId = overview.body[0].id as string;

    const base = await api(
      "GET",
      `/ev/range-estimate?vehicleId=${vehicleId}`,
      adminToken,
    );
    expect(base.status).toBe(200);
    expect(base.body.usableRangeKm).toBeGreaterThan(0);

    // Frío (-5 °C, por debajo de los 21 °C de referencia) derrata la autonomía.
    const cold = await api(
      "GET",
      `/ev/range-estimate?vehicleId=${vehicleId}&temperatureC=-5`,
      adminToken,
    );
    expect(cold.status).toBe(200);
    expect(cold.body.usableRangeKm).toBeLessThan(base.body.usableRangeKm);
  });

  it("/ev/range-estimate responde 404 para un vehículo inexistente", async () => {
    const res = await api(
      "GET",
      "/ev/range-estimate?vehicleId=no-existe",
      adminToken,
    );
    expect(res.status).toBe(404);
  });

  it("el catálogo reporta EV_MANAGEMENT activo y de núcleo; el toggle se rechaza", async () => {
    const modules = await api("GET", "/modules", adminToken);
    expect(modules.status).toBe(200);
    const ev = modules.body.find(
      (m: { key: string }) => m.key === "EV_MANAGEMENT",
    );
    expect(ev.enabled).toBe(true);
    expect(ev.core).toBe(true);

    const toggle = await api("PATCH", "/modules/EV_MANAGEMENT", adminToken, {
      enabled: false,
    });
    expect(toggle.status).toBe(400);
    expect(toggle.body.code).toBe("CORE_MODULE");
  });

  it("la sesión incluye EV_MANAGEMENT aunque el entitlement esté en false", async () => {
    const me = await api("GET", "/auth/me", adminToken);
    expect(me.status).toBe(200);
    expect(me.body.modules).toContain("EV_MANAGEMENT");
  });

  it("el directorio de carga ordena por cercanía y aísla depósitos ajenos", async () => {
    const res = await api(
      "GET",
      "/ev/charging-stations?lat=4.65&lng=-74.06&limit=10",
      adminToken,
    );
    expect(res.status).toBe(200);
    const names = res.body.map((s: { name: string }) => s.name);
    expect(names).toContain(`Pública Cercana ${runId}`);
    expect(names).not.toContain(`Depósito Ajeno ${runId}`);

    // La más cercana al origen va primero y trae la distancia calculada.
    const nearest = res.body.find(
      (s: { id: string }) => s.id === publicStationId,
    );
    expect(nearest).toBeDefined();
    expect(res.body[0].id).toBe(publicStationId);
    expect(nearest.distanceKm).toBeLessThan(0.5);
  });

  it("el conductor (rol DRIVER) consulta el directorio de carga", async () => {
    const driver = await api("POST", "/drivers", adminToken, {
      name: "Conductor EV",
      phone: "+573000000099",
      documentId: "900800700",
      email: driverEmail,
      password: "moveos123",
    });
    expect(driver.status).toBe(201);

    const login = await api("POST", "/auth/login", undefined, {
      email: driverEmail,
      password: "moveos123",
    });
    driverToken = login.body.token;

    const res = await api(
      "GET",
      "/ev/charging-stations?lat=4.65&lng=-74.06&limit=1",
      driverToken,
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});
