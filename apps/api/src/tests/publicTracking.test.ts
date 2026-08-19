import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Página pública de rastreo: el negocio cliente sigue su envío con un token
 * opaco, SIN autenticación, viendo solo datos sanitizados.
 */

const runId = Date.now();
const adminEmail = `track-admin+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;

async function api(method: "GET" | "POST", url: string, token?: string, body?: unknown) {
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
    tenantName: "Test Tracking",
    adminName: "Admin",
    city: "Bogotá",
    email: adminEmail,
    password: "dalego123",
  });
  tenantId = reg.body.tenant.id;
  adminToken = reg.body.token;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("rastreo público", () => {
  let trackingToken: string;

  it("un pedido nuevo recibe un token de rastreo opaco (distinto de la guía)", async () => {
    const order = await api("POST", "/orders", adminToken, {
      customerName: "Destinatario",
      customerPhone: "+573111111111",
      addressRaw: "Cra 13 # 54-20",
      lat: 4.6416,
      lng: -74.0639,
    });
    expect(order.status).toBe(201);
    // El token se devuelve al crear (campo del pedido).
    const detail = await api("GET", `/orders/${order.body.id}`, adminToken);
    trackingToken = detail.body.trackingToken;
    expect(trackingToken).toBeTruthy();
    expect(trackingToken).not.toBe(detail.body.trackingNumber);
  });

  it("GET /track/:token devuelve estado y línea de tiempo SIN autenticación", async () => {
    const res = await api("GET", `/track/${trackingToken}`);
    expect(res.status).toBe(200);
    expect(res.body.recipient).toBe("Destinatario");
    expect(res.body.status).toBe("GEOCODED");
    expect(Array.isArray(res.body.timeline)).toBe(true);
    expect(res.body.timeline.length).toBeGreaterThan(0);
    // No debe filtrar el teléfono del destinatario ni datos internos.
    expect(JSON.stringify(res.body)).not.toContain("+573111111111");
  });

  it("un token inexistente devuelve 404", async () => {
    const res = await api("GET", "/track/token-que-no-existe-1234567890");
    expect(res.status).toBe(404);
  });
});
