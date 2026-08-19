import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Cockpit de excepciones: posponer (snooze) oculta una excepción de la cola
 * por un rato sin resolverla, el aplazo es por tenant, y reactivar/expirar la
 * devuelve si la condición persiste. Escenario determinista: una dirección sin
 * confirmar (forzada vía Prisma) produce siempre la excepción "triage-pending".
 */

const runId = Date.now();
const aEmail = `exc-a+${runId}@test.moveos.co`;
const bEmail = `exc-b+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tokenA: string;
let tokenB: string;
let tenantAId: string;
let tenantBId: string;

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

const ids = (body: { items: { id: string }[] }) => body.items.map((i) => i.id);
const snoozedKeys = (body: { snoozed: { key: string }[] }) =>
  body.snoozed.map((s) => s.key);

/** Fuerza que el pedido del tenant cuente como "dirección sin confirmar". */
async function forceUnconfirmed(tenantId: string) {
  await prisma.order.updateMany({
    where: { tenantId },
    data: {
      status: "PENDING",
      addressVerifiedAt: null,
      geocodeSource: "MOCK",
      geoConfidence: null,
    },
  });
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  const a = await api("POST", "/auth/register", undefined, {
    tenantName: "Exc A",
    adminName: "Admin A",
    city: "Bogotá",
    email: aEmail,
    password: "dalego123",
  });
  tokenA = a.body.token;
  tenantAId = a.body.tenant.id;

  const b = await api("POST", "/auth/register", undefined, {
    tenantName: "Exc B",
    adminName: "Admin B",
    city: "Bogotá",
    email: bEmail,
    password: "dalego123",
  });
  tokenB = b.body.token;
  tenantBId = b.body.tenant.id;

  for (const token of [tokenA, tokenB]) {
    await api("POST", "/orders", token, {
      customerName: "Destino sin confirmar",
      customerPhone: "+573110000000",
      addressRaw: "Cl 72 # 10-34",
    });
  }
  await forceUnconfirmed(tenantAId);
  await forceUnconfirmed(tenantBId);
});

afterAll(async () => {
  for (const id of [tenantAId, tenantBId]) {
    if (id) await prisma.tenant.delete({ where: { id } }).catch(() => {});
  }
  await app.close();
  await prisma.$disconnect();
});

describe("posponer excepciones del cockpit", () => {
  it("la cola incluye la dirección sin confirmar y no hay pospuestas", async () => {
    const res = await api("GET", "/exceptions", tokenA);
    expect(res.status).toBe(200);
    expect(ids(res.body)).toContain("triage-pending");
    expect(res.body.snoozed).toHaveLength(0);
  });

  it("posponer la oculta de la cola y la registra en pospuestas", async () => {
    const snooze = await api("POST", "/exceptions/snooze", tokenA, {
      key: "triage-pending",
      minutes: 60,
    });
    expect(snooze.status).toBe(200);
    expect(snooze.body.key).toBe("triage-pending");
    expect(snooze.body.until).toBeTruthy();

    const res = await api("GET", "/exceptions", tokenA);
    expect(ids(res.body)).not.toContain("triage-pending");
    expect(snoozedKeys(res.body)).toContain("triage-pending");
  });

  it("el aplazo es por tenant: no afecta a otro tenant", async () => {
    const res = await api("GET", "/exceptions", tokenB);
    expect(ids(res.body)).toContain("triage-pending");
    expect(res.body.snoozed).toHaveLength(0);
  });

  it("reactivar (DELETE) devuelve la excepción a la cola", async () => {
    const del = await api("DELETE", "/exceptions/snooze/triage-pending", tokenA);
    expect(del.status).toBe(200);

    const res = await api("GET", "/exceptions", tokenA);
    expect(ids(res.body)).toContain("triage-pending");
    expect(res.body.snoozed).toHaveLength(0);
  });

  it("cuerpo inválido (minutes no positivo) → 400", async () => {
    const res = await api("POST", "/exceptions/snooze", tokenA, {
      key: "triage-pending",
      minutes: 0,
    });
    expect(res.status).toBe(400);
  });

  it("exige autenticación (401 sin token)", async () => {
    const res = await api("POST", "/exceptions/snooze", undefined, {
      key: "triage-pending",
      minutes: 60,
    });
    expect(res.status).toBe(401);
  });
});

describe("recordatorios de documentos por vencer (Phase E)", () => {
  it("un SOAT vencido aparece como excepción DOC_EXPIRY (severidad HIGH)", async () => {
    const past = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const v = await api("POST", "/vehicles", tokenA, {
      plate: "DOC1Z9",
      type: "IONAX",
      capacityKg: 600,
      isElectric: true,
      nominalRangeKm: 200,
      soatExpiresAt: past,
    });
    expect(v.status).toBe(201);

    const res = await api("GET", "/exceptions", tokenA);
    const doc = res.body.items.find(
      (i: { id: string }) => i.id === `doc-vehicle-soat-${v.body.id}`,
    );
    expect(doc).toBeTruthy();
    expect(doc.type).toBe("DOC_EXPIRY");
    expect(doc.severity).toBe("HIGH");
    expect(doc.title).toContain("SOAT");
  });

  it("el recordatorio es por tenant: no aparece en otro tenant", async () => {
    const res = await api("GET", "/exceptions", tokenB);
    const any = res.body.items.some(
      (i: { type: string }) => i.type === "DOC_EXPIRY",
    );
    expect(any).toBe(false);
  });
});
