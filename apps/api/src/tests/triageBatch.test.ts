import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Confirmación en lote del triage de direcciones: acepta el pin actual de
 * varios pedidos a la vez, los marca verificados y enseña el pin al grafo
 * (mismo camino que la corrección individual). Omite los que no tienen
 * coordenadas.
 */

const runId = Date.now();
const adminEmail = `triage-admin+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;

async function api(
  method: "GET" | "POST" | "PATCH" | "DELETE",
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

async function makeTriageOrder(name: string, coords: boolean): Promise<string> {
  const res = await api("POST", "/orders", adminToken, {
    customerName: name,
    customerPhone: "+573110000000",
    addressRaw: `Dir ${name} ${runId}`,
  });
  expect(res.status).toBe(201);
  const id = res.body.id as string;
  // Forzar la condición de triage (baja confianza, sin verificar) y, según el
  // caso, con o sin coordenadas.
  await prisma.order.update({
    where: { id },
    data: {
      status: "PENDING",
      geoConfidence: 0.3,
      geocodeSource: "MOCK",
      addressVerifiedAt: null,
      lat: coords ? 4.65 : null,
      lng: coords ? -74.06 : null,
    },
  });
  return id;
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const reg = await api("POST", "/auth/register", undefined, {
    tenantName: "Triage Batch",
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

describe("confirmación en lote del triage", () => {
  it("confirma las que tienen pin, aprende el grafo y omite las sin coordenadas", async () => {
    const withCoords = await makeTriageOrder("ConPin", true);
    const noCoords = await makeTriageOrder("SinPin", false);

    const res = await api("POST", "/addresses/triage/confirm", adminToken, {
      orderIds: [withCoords, noCoords],
    });
    expect(res.status).toBe(200);
    expect(res.body.confirmed).toBe(1);
    expect(res.body.skipped).toContain(noCoords);

    const a = await prisma.order.findUnique({ where: { id: withCoords } });
    expect(a?.addressVerifiedAt).not.toBeNull();
    expect(a?.geoConfidence).toBe(1);
    expect(a?.geocodeSource).toBe("MANUAL_PIN");

    // El grafo aprendió al menos un pin para este tenant (acierto futuro).
    const pins = await prisma.addressPin.count({ where: { tenantId } });
    expect(pins).toBeGreaterThanOrEqual(1);

    // La confirmada sale de la cola de triage; la sin coordenadas permanece.
    const triage = await api("GET", "/addresses/triage", adminToken);
    const ids = triage.body.orders.map((o: { id: string }) => o.id);
    expect(ids).not.toContain(withCoords);
    expect(ids).toContain(noCoords);
  });

  it("cuerpo inválido (sin orderIds) → 400", async () => {
    const res = await api("POST", "/addresses/triage/confirm", adminToken, {
      orderIds: [],
    });
    expect(res.status).toBe(400);
  });
});
