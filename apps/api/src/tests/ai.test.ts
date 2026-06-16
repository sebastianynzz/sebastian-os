import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { learnAddressPin } from "../services/geocoding.js";

/**
 * Capa de optimización con IA (/ai/actions). Verifica el contrato run → apply:
 * gating por módulo (AI_ADDONS), propuesta con impacto real, aplicación
 * idempotente y auditada, aislamiento por tenant, y que reusa los solvers
 * deterministas existentes (VRP, cascada de direcciones).
 */

const runId = Date.now();
const adminEmail = `ai-admin+${runId}@test.moveos.co`;
const otherEmail = `ai-other+${runId}@test.moveos.co`;
const DEPOT = { lat: 4.6486, lng: -74.0628 };

let app: FastifyInstance;
let tenantId: string;
let otherTenantId: string;
let adminToken: string;
let otherToken: string;

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

async function enableModule(tid: string, moduleKey: string) {
  await prisma.moduleEntitlement.upsert({
    where: { tenantId_moduleKey: { tenantId: tid, moduleKey } },
    create: { tenantId: tid, moduleKey, enabled: true },
    update: { enabled: true },
  });
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  const reg = await api("POST", "/auth/register", undefined, {
    tenantName: "Test AI",
    adminName: "Admin AI",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = reg.body.tenant.id;
  adminToken = reg.body.token;

  const other = await api("POST", "/auth/register", undefined, {
    tenantName: "Test AI Otro",
    adminName: "Admin Otro",
    city: "Bogotá",
    email: otherEmail,
    password: "moveos123",
  });
  otherTenantId = other.body.tenant.id;
  otherToken = other.body.token;
});

afterAll(async () => {
  for (const tid of [tenantId, otherTenantId]) {
    if (tid) await prisma.tenant.delete({ where: { id: tid } }).catch(() => {});
  }
  await app.close();
  await prisma.$disconnect();
});

describe("/ai/actions — gating por módulo AI_ADDONS", () => {
  it("rechaza el catálogo si el módulo no está activo", async () => {
    const res = await api("GET", "/ai/actions", adminToken);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("MODULE_NOT_ENABLED");
  });

  it("expone las acciones registradas al activar el módulo", async () => {
    await enableModule(tenantId, "AI_ADDONS");
    await enableModule(otherTenantId, "AI_ADDONS");
    const res = await api("GET", "/ai/actions", adminToken);
    expect(res.status).toBe(200);
    const ids = res.body.actions.map((a: { id: string }) => a.id).sort();
    expect(ids).toContain("optimize_routes");
    expect(ids).toContain("resolve_addresses");
    // optimize_cold_chain exige COLD_CHAIN (no activo) → no debe aparecer.
    expect(ids).not.toContain("optimize_cold_chain");
  });
});

describe("optimize_routes — run → apply (envuelve el VRP)", () => {
  let proposalId: string;
  let orderIds: string[] = [];
  let vehicleId: string;

  it("genera una propuesta con impacto real (sin mutar)", async () => {
    const v = await api("POST", "/vehicles", adminToken, {
      plate: `AIV${runId.toString().slice(-4)}`,
      type: "IONAX",
      capacityKg: 530,
      capacityM3: 3,
      isElectric: true,
      batteryKwh: 11.52,
      nominalRangeKm: 130,
    });
    expect(v.status).toBe(201);
    vehicleId = v.body.id;

    for (const [i, dest] of [
      { addressRaw: "Cl 72 # 10-34", customerName: "Uno" },
      { addressRaw: "Cra 15 # 93-60", customerName: "Dos" },
    ].entries()) {
      const o = await api("POST", "/orders", adminToken, {
        customerName: dest.customerName,
        customerPhone: `+57311000000${i}`,
        addressRaw: dest.addressRaw,
      });
      expect(o.status).toBe(201);
      orderIds.push(o.body.id);
    }

    const run = await api("POST", "/ai/actions/optimize_routes/run", adminToken, {
      orderIds,
      vehicleIds: [vehicleId],
      date: "2026-06-17",
      params: { depot: DEPOT },
    });
    expect(run.status).toBe(200);
    expect(run.body.actionId).toBe("optimize_routes");
    expect(run.body.mutates).toBe(true);
    expect(run.body.feasible).toBe(true);
    expect(run.body.impact.vehiclesUsed).toBeGreaterThanOrEqual(1);
    expect(typeof run.body.summaryEs).toBe("string");
    proposalId = run.body.proposalId;

    // run NO debe haber asignado nada todavía.
    const stillPending = await prisma.order.count({
      where: { id: { in: orderIds }, status: "GEOCODED" },
    });
    expect(stillPending).toBe(2);
  });

  it("otro tenant no puede aplicar la propuesta (aislamiento)", async () => {
    const res = await api(
      "POST",
      "/ai/actions/optimize_routes/apply",
      otherToken,
      { proposalId },
    );
    expect(res.status).toBe(404);
  });

  it("aplica la propuesta: crea rutas y asigna pedidos", async () => {
    const res = await api(
      "POST",
      "/ai/actions/optimize_routes/apply",
      adminToken,
      { proposalId },
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.routes).toBeGreaterThanOrEqual(1);

    const assigned = await prisma.order.count({
      where: { id: { in: orderIds }, status: "ASSIGNED" },
    });
    expect(assigned).toBe(2);
  });

  it("es idempotente: re-aplicar devuelve 409", async () => {
    const res = await api(
      "POST",
      "/ai/actions/optimize_routes/apply",
      adminToken,
      { proposalId },
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_APPLIED");
  });

  it("aplicar un proposalId inexistente devuelve 404", async () => {
    const res = await api(
      "POST",
      "/ai/actions/optimize_routes/apply",
      adminToken,
      { proposalId: "noexiste" },
    );
    expect(res.status).toBe(404);
  });
});

describe("resolve_addresses — run → apply (envuelve la cascada de direcciones)", () => {
  it("propone y aplica el pin aprendido del grafo", async () => {
    const address = `Calle Grafo ${runId} # 1-2`;
    // 1) El pedido entra ambiguo (geocodificado por MOCK, sin pin en el grafo).
    const o = await api("POST", "/orders", adminToken, {
      customerName: "Frente al grafo",
      customerPhone: "+573110009999",
      addressRaw: address,
    });
    expect(o.status).toBe(201);
    const orderId = o.body.id;

    // 2) El grafo aprende el pin (alta confianza) DESPUÉS de crear el pedido.
    await learnAddressPin(tenantId, address, 4.67, -74.05, "Portería azul", {
      source: "DISPATCHER_CONFIRMED",
      city: "Bogotá",
    });

    const run = await api(
      "POST",
      "/ai/actions/resolve_addresses/run",
      adminToken,
      { orderIds: [orderId] },
    );
    expect(run.status).toBe(200);
    expect(run.body.feasible).toBe(true);
    const resolved = run.body.change.resolved.find(
      (r: { orderId: string }) => r.orderId === orderId,
    );
    expect(resolved.resolvable).toBe(true);
    expect(resolved.source).toBe("ADDRESS_PIN");

    const apply = await api(
      "POST",
      "/ai/actions/resolve_addresses/apply",
      adminToken,
      { proposalId: run.body.proposalId },
    );
    expect(apply.status).toBe(200);
    expect(apply.body.data.applied).toBeGreaterThanOrEqual(1);

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(updated.addressVerifiedAt).not.toBeNull();
    expect(updated.lat).toBeCloseTo(4.67, 5);
  });
});
