import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Triage de direcciones — confirmación en lote (triage rápido). El despachador
 * da por buenos varios pines de una vez; cada confirmación enseña al grafo
 * (la moat). Regla dura: NUNCA se confirma/aprende en lote un pin de prueba
 * (MOCK) ni uno sin coordenadas — esos requieren pin manual en el mapa.
 */

const runId = Date.now();
const adminEmail = `addr-admin+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;
let okId = "";
let mockId = "";
let noCoordsId = "";

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

async function createOrder(name: string, addressRaw: string) {
  const res = await api("POST", "/orders", adminToken, {
    customerName: name,
    customerPhone: "+573000000000",
    addressRaw,
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  const reg = await api("POST", "/auth/register", undefined, {
    tenantName: "Test Direcciones",
    adminName: "Admin Dir",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = reg.body.tenant.id;
  adminToken = reg.body.token;

  // Tres pedidos en la cola de triage, con estados de geocodificación distintos.
  okId = await createOrder("Pin Razonable", `Cra 13 # 54-20 ${runId}`);
  mockId = await createOrder("Pin de Prueba", `Frente al parque ${runId}`);
  noCoordsId = await createOrder("Sin Coordenadas", `Lote sin nomenclatura ${runId}`);

  // okId: pin real de Google con confianza baja (entra a triage, es confirmable).
  await prisma.order.update({
    where: { id: okId },
    data: {
      lat: 4.65,
      lng: -74.06,
      geocodeSource: "GOOGLE",
      geoConfidence: 0.5,
      addressVerifiedAt: null,
    },
  });
  // mockId: geocodificador de prueba (coords falsas) — NO confirmable en lote.
  await prisma.order.update({
    where: { id: mockId },
    data: { geocodeSource: "MOCK", geoConfidence: 0.3, addressVerifiedAt: null },
  });
  // noCoordsId: sin coordenadas — NO confirmable en lote.
  await prisma.order.update({
    where: { id: noCoordsId },
    data: {
      lat: null,
      lng: null,
      geocodeSource: "GOOGLE",
      geoConfidence: 0.4,
      addressVerifiedAt: null,
    },
  });
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("triage de direcciones — confirmación en lote", () => {
  it("la cola de triage incluye los tres pedidos de baja confianza", async () => {
    const res = await api("GET", "/addresses/triage", adminToken);
    expect(res.status).toBe(200);
    const ids = res.body.orders.map((o: { id: string }) => o.id);
    expect(ids).toEqual(expect.arrayContaining([okId, mockId, noCoordsId]));
  });

  it("confirma el pin razonable y omite MOCK / sin-coordenadas, enseñando solo el bueno", async () => {
    const res = await api("POST", "/addresses/triage/confirm", adminToken, {
      orderIds: [okId, mockId, noCoordsId],
    });
    expect(res.status).toBe(200);
    expect(res.body.confirmed).toBe(1);
    expect(res.body.skipped).toHaveLength(2);
    const skippedIds = res.body.skipped.map((s: { id: string }) => s.id);
    expect(skippedIds).toEqual(expect.arrayContaining([mockId, noCoordsId]));

    // El pin bueno queda verificado con confianza 1.
    const ok = await prisma.order.findUnique({ where: { id: okId } });
    expect(ok?.geoConfidence).toBe(1);
    expect(ok?.addressVerifiedAt).not.toBeNull();

    // Los no-confirmables siguen sin verificar (no se tocaron).
    const mock = await prisma.order.findUnique({ where: { id: mockId } });
    expect(mock?.addressVerifiedAt).toBeNull();
    const noCoords = await prisma.order.findUnique({ where: { id: noCoordsId } });
    expect(noCoords?.addressVerifiedAt).toBeNull();

    // El grafo aprendió EXACTAMENTE un pin (el bueno), por despacho.
    const pins = await prisma.addressPin.findMany({ where: { tenantId } });
    expect(pins).toHaveLength(1);
    expect(pins[0]?.source).toBe("DISPATCHER_CONFIRMED");
    expect(pins[0]?.lat).toBeCloseTo(4.65);
    expect(pins[0]?.lng).toBeCloseTo(-74.06);
  });

  it("tras confirmar, el pin bueno sale de la cola de triage", async () => {
    const res = await api("GET", "/addresses/triage", adminToken);
    const ids = res.body.orders.map((o: { id: string }) => o.id);
    expect(ids).not.toContain(okId);
    expect(ids).toEqual(expect.arrayContaining([mockId, noCoordsId]));
  });
});
