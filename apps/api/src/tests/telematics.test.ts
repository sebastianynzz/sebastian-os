import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Prueba de integración del plano telemático / IoT:
 * ingesta GPS+CAN → estado en vivo → interlock de apagado de motor →
 * acuse del dispositivo → gating de módulos.
 *
 * Requiere DATABASE_URL apuntando a un Postgres con el esquema aplicado.
 */

const runId = Date.now();
const adminEmail = `tele-admin+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;
let vehicleId: string;
const PLATE = "TLM99Z";

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
    tenantName: "Test Telemática",
    adminName: "Admin Tele",
    city: "Bogotá",
    email: adminEmail,
    password: "dalego123",
  });
  tenantId = reg.body.tenant.id;
  adminToken = reg.body.token;

  // TELEMATICS y SAFETY nacen apagados; el admin los activa por contrato.
  await api("PATCH", "/modules/TELEMATICS", adminToken, { enabled: true });
  await api("PATCH", "/modules/SAFETY", adminToken, { enabled: true });

  const vehicle = await api("POST", "/vehicles", adminToken, {
    plate: PLATE,
    type: "RAP_MOVE_LIGHT",
    capacityKg: 20,
  });
  vehicleId = vehicle.body.id;
});

afterAll(async () => {
  if (tenantId) {
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  }
  await app.close();
  await prisma.$disconnect();
});

describe("plano telemático / IoT", () => {
  it("ingiere un ping GPS+CAN y lo refleja en el estado en vivo", async () => {
    const ping = await api("POST", "/telematics/ingest", adminToken, {
      plate: PLATE,
      lat: 4.65,
      lng: -74.06,
      speedKmh: 32,
      rpm: 3200,
      fuelLevelPct: 70,
      odometerKm: 15000,
      engineOn: true,
      source: "SIMULATOR",
    });
    expect(ping.status).toBe(201);

    const live = await api("GET", "/telematics/vehicles/live", adminToken);
    expect(live.status).toBe(200);
    const entry = live.body.find(
      (e: { vehicle: { plate: string } }) => e.vehicle.plate === PLATE,
    );
    expect(entry).toBeDefined();
    expect(entry.vehicle.lastSpeedKmh).toBe(32);
    // El estado en vivo se sirve de las columnas denormalizadas del vehículo,
    // no de un findFirst contra TelemetryPing. Los campos CAN de combustión
    // (rpm/fuelLevelPct/coolantTempC) viajan siempre en null: daleGo es EV-only
    // (restricción dura 1.2).
    expect(entry.ping.lat).toBe(4.65);
    expect(entry.ping.lng).toBe(-74.06);
    expect(entry.ping.odometerKm).toBe(15000);
    expect(entry.ping.rpm).toBeNull();

    // La posición queda denormalizada en el vehículo (alimenta el mapa de flota
    // de plataforma sin recorrer TelemetryPing).
    const v = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
    expect(v?.lastLat).toBe(4.65);
    expect(v?.lastLng).toBe(-74.06);
  });

  it("RECHAZA apagar el motor en movimiento (interlock de seguridad)", async () => {
    // El último ping dejó el vehículo a 32 km/h.
    const cmd = await api("POST", `/telematics/vehicles/${vehicleId}/commands`, adminToken, {
      type: "ENGINE_OFF",
      reason: "Intento mientras se mueve",
    });
    expect(cmd.status).toBe(422);
    expect(cmd.body.code).toBe("VEHICLE_IN_MOTION");
  });

  it("permite apagar el motor con el vehículo detenido y el dispositivo lo confirma", async () => {
    // Ping de vehículo detenido.
    await api("POST", "/telematics/ingest", adminToken, {
      plate: PLATE,
      lat: 4.65,
      lng: -74.06,
      speedKmh: 0,
      engineOn: true,
      source: "SIMULATOR",
    });

    const cmd = await api("POST", `/telematics/vehicles/${vehicleId}/commands`, adminToken, {
      type: "ENGINE_OFF",
      reason: "Reporte de robo",
    });
    expect(cmd.status).toBe(201);
    expect(cmd.body.status).toBe("PENDING");

    // El dispositivo reclama y confirma.
    const poll = await api("POST", `/telematics/vehicles/${vehicleId}/commands/poll`, adminToken);
    expect(poll.body).toHaveLength(1);
    const ack = await api("POST", `/telematics/commands/${cmd.body.id}/ack`, adminToken, {
      accepted: true,
    });
    expect(ack.body.status).toBe("ACK");

    // El vehículo quedó inmovilizado con el motor apagado.
    const live = await api("GET", "/telematics/vehicles/live", adminToken);
    const entry = live.body.find(
      (e: { vehicle: { plate: string } }) => e.vehicle.plate === PLATE,
    );
    expect(entry.vehicle.engineOn).toBe(false);
    expect(entry.vehicle.immobilized).toBe(true);
  });

  it("bloquea la API si el módulo TELEMATICS está inactivo", async () => {
    // SAFETY depende de TELEMATICS: desactivar la dependencia antes de poder
    // apagar TELEMATICS (grafo de dependencias de módulos).
    await api("PATCH", "/modules/SAFETY", adminToken, { enabled: false });
    await api("PATCH", "/modules/TELEMATICS", adminToken, { enabled: false });
    const blocked = await api("GET", "/telematics/vehicles/live", adminToken);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("MODULE_NOT_ENABLED");
    await api("PATCH", "/modules/TELEMATICS", adminToken, { enabled: true });
    await api("PATCH", "/modules/SAFETY", adminToken, { enabled: true });
  });

  it("exige el módulo SAFETY para enviar comandos de motor", async () => {
    await api("PATCH", "/modules/SAFETY", adminToken, { enabled: false });
    const blocked = await api("POST", `/telematics/vehicles/${vehicleId}/commands`, adminToken, {
      type: "ENGINE_ON",
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("MODULE_NOT_ENABLED");
    await api("PATCH", "/modules/SAFETY", adminToken, { enabled: true });
  });
});
