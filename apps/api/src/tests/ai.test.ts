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
    expect(ids).toContain("optimize_load");
    expect(ids).toContain("pick_vehicle");
    expect(ids).toContain("reoptimize_route");
    expect(ids).toContain("optimize_charging"); // ⚡ solo requiere AI_ADDONS
    expect(ids).toContain("optimize_schedule");
    expect(ids).toContain("plan_capacity");
    // optimize_cold_chain exige COLD_CHAIN (no activo) → no debe aparecer.
    expect(ids).not.toContain("optimize_cold_chain");
  });

  it("expone optimize_cold_chain al activar el módulo COLD_CHAIN", async () => {
    await enableModule(tenantId, "COLD_CHAIN");
    const res = await api("GET", "/ai/actions", adminToken);
    const ids = res.body.actions.map((a: { id: string }) => a.id);
    expect(ids).toContain("optimize_cold_chain");
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

describe("pick_vehicle — asesor (no muta)", () => {
  it("recomienda la Cold Box congeladora para carga FROZEN", async () => {
    const run = await api("POST", "/ai/actions/pick_vehicle/run", adminToken, {
      params: { totalKg: 30, totalM3: 0.3, coldChain: "FROZEN", distanceKm: 40 },
    });
    expect(run.status).toBe(200);
    expect(run.body.mutates).toBe(false);
    expect(run.body.feasible).toBe(true);
    expect(run.body.change.ranked[0].type).toBe("RAP_MOVE_COLD_BOX");
  });

  it("aplicar una acción asesora devuelve 400", async () => {
    const run = await api("POST", "/ai/actions/pick_vehicle/run", adminToken, {
      params: { totalKg: 10, distanceKm: 30 },
    });
    const apply = await api(
      "POST",
      "/ai/actions/pick_vehicle/apply",
      adminToken,
      { proposalId: run.body.proposalId },
    );
    expect(apply.status).toBe(400);
    expect(apply.body.code).toBe("ADVISORY_ONLY");
  });
});

describe("optimize_load — empaque (asesor)", () => {
  it("propone una asignación pedido→vehículo por capacidad", async () => {
    const v = await api("POST", "/vehicles", adminToken, {
      plate: `LOA${runId.toString().slice(-4)}`,
      type: "IONAX",
      capacityKg: 530,
      capacityM3: 3,
      isElectric: true,
      batteryKwh: 11.52,
      nominalRangeKm: 130,
    });
    const ids: string[] = [];
    for (const [i, name] of ["Carga A", "Carga B"].entries()) {
      const o = await api("POST", "/orders", adminToken, {
        customerName: name,
        customerPhone: `+57311222000${i}`,
        addressRaw: "Cra 7 # 32-16",
        weightKg: 50,
      });
      ids.push(o.body.id);
    }
    const run = await api("POST", "/ai/actions/optimize_load/run", adminToken, {
      orderIds: ids,
      vehicleIds: [v.body.id],
    });
    expect(run.status).toBe(200);
    expect(run.body.mutates).toBe(false);
    expect(run.body.feasible).toBe(true);
    expect(run.body.change.assignments[0].orderIds.length).toBe(2);
  });
});

describe("reoptimize_route — inserción exprés (envuelve la inserción)", () => {
  it("inserta un pedido pendiente en una ruta existente y lo aplica", async () => {
    const v = await api("POST", "/vehicles", adminToken, {
      plate: `REO${runId.toString().slice(-4)}`,
      type: "IONAX",
      capacityKg: 530,
      capacityM3: 3,
      isElectric: true,
      batteryKwh: 11.52,
      nominalRangeKm: 130,
    });
    const baseOrder = await api("POST", "/orders", adminToken, {
      customerName: "Base ruta",
      customerPhone: "+573114440001",
      addressRaw: "Cl 72 # 10-34",
    });
    // Crear una ruta con el endpoint manual (ROUTE_OPTIMIZATION va por defecto).
    const plan = await api("POST", "/optimization/plans", adminToken, {
      date: "2026-06-18",
      depot: DEPOT,
      orderIds: [baseOrder.body.id],
      vehicleIds: [v.body.id],
    });
    expect(plan.status).toBe(201);
    const routeId = plan.body.routes[0].id;

    const extra = await api("POST", "/orders", adminToken, {
      customerName: "Inserción exprés",
      customerPhone: "+573114440002",
      addressRaw: "Cra 15 # 93-60",
    });

    const run = await api(
      "POST",
      "/ai/actions/reoptimize_route/run",
      adminToken,
      { routeId, params: { orderId: extra.body.id } },
    );
    expect(run.status).toBe(200);
    expect(run.body.feasible).toBe(true);

    const apply = await api(
      "POST",
      "/ai/actions/reoptimize_route/apply",
      adminToken,
      { proposalId: run.body.proposalId },
    );
    expect(apply.status).toBe(200);
    expect(apply.body.ok).toBe(true);

    const stop = await prisma.routeStop.findFirst({
      where: { routeId, orderId: extra.body.id },
    });
    expect(stop).not.toBeNull();
  });
});

describe("optimize_charging — programación de carga (asesor ⚡)", () => {
  it("propone un plan de carga para la ruta del día", async () => {
    const v = await api("POST", "/vehicles", adminToken, {
      plate: `CHG${runId.toString().slice(-4)}`,
      type: "IONAX",
      capacityKg: 530,
      capacityM3: 3,
      isElectric: true,
      batteryKwh: 11.52,
      nominalRangeKm: 130,
    });
    const o = await api("POST", "/orders", adminToken, {
      customerName: "Carga ruta",
      customerPhone: "+573115550001",
      addressRaw: "Cl 72 # 10-34",
    });
    const plan = await api("POST", "/optimization/plans", adminToken, {
      date: "2026-06-19",
      depot: DEPOT,
      orderIds: [o.body.id],
      vehicleIds: [v.body.id],
    });
    expect(plan.status).toBe(201);

    const run = await api("POST", "/ai/actions/optimize_charging/run", adminToken, {
      vehicleIds: [v.body.id],
      date: "2026-06-19",
    });
    expect(run.status).toBe(200);
    expect(run.body.mutates).toBe(false);
    expect(run.body.change.plans.length).toBeGreaterThanOrEqual(1);
    expect(run.body.change.plans[0].window).toBe("Valle (noche)");

    const apply = await api("POST", "/ai/actions/optimize_charging/apply", adminToken, {
      proposalId: run.body.proposalId,
    });
    expect(apply.status).toBe(400);
    expect(apply.body.code).toBe("ADVISORY_ONLY");
  });
});

describe("optimize_cold_chain — secuenciación reefer (asesor ❄️, módulo COLD_CHAIN)", () => {
  it("recomienda el orden de entrega para una ruta refrigerada", async () => {
    await enableModule(tenantId, "COLD_CHAIN");
    const v = await api("POST", "/vehicles", adminToken, {
      plate: `CLD${runId.toString().slice(-4)}`,
      type: "IONAX_COLD_BOX",
      capacityKg: 530,
      capacityM3: 2.8,
      isElectric: true,
      batteryKwh: 11.52,
      nominalRangeKm: 130,
    });
    const o = await api("POST", "/orders", adminToken, {
      customerName: "Refrigerado",
      customerPhone: "+573115550002",
      addressRaw: "Cra 15 # 93-60",
      tempProfile: "CHILLED",
    });
    const plan = await api("POST", "/optimization/plans", adminToken, {
      date: "2026-06-20",
      depot: DEPOT,
      orderIds: [o.body.id],
      vehicleIds: [v.body.id],
    });
    expect(plan.status).toBe(201);
    const routeId = plan.body.routes[0].id;

    const run = await api("POST", "/ai/actions/optimize_cold_chain/run", adminToken, {
      routeId,
    });
    expect(run.status).toBe(200);
    expect(run.body.feasible).toBe(true);
    expect(run.body.change.order).toContain(o.body.id);
    expect(run.body.change.preCoolLeadMin).toBeGreaterThanOrEqual(30);
  });
});

describe("optimize_schedule — turnos y oleadas (asesor)", () => {
  it("propone oleadas y reporta cobertura", async () => {
    await api("POST", "/drivers", adminToken, {
      name: "Conductor Turno",
      phone: "+573116660001",
      documentId: `DOC${runId}`,
    });
    const run = await api("POST", "/ai/actions/optimize_schedule/run", adminToken, {
      date: "2026-06-21",
    });
    expect(run.status).toBe(200);
    expect(run.body.mutates).toBe(false);
    expect(run.body.change.waves.length).toBeGreaterThanOrEqual(2);
    const apply = await api("POST", "/ai/actions/optimize_schedule/apply", adminToken, {
      proposalId: run.body.proposalId,
    });
    expect(apply.status).toBe(400);
    expect(apply.body.code).toBe("ADVISORY_ONLY");
  });
});

describe("plan_capacity — capacidad de flota (asesor, no muta)", () => {
  it("recomienda flota + conductores y no se puede aplicar", async () => {
    const run = await api("POST", "/ai/actions/plan_capacity/run", adminToken, {});
    expect(run.status).toBe(200);
    expect(run.body.mutates).toBe(false);
    expect(run.body.change.recommended).toBeDefined();
    expect(typeof run.body.change.driversNeeded).toBe("number");
    const apply = await api("POST", "/ai/actions/plan_capacity/apply", adminToken, {
      proposalId: run.body.proposalId,
    });
    expect(apply.status).toBe(400);
    expect(apply.body.code).toBe("ADVISORY_ONLY");
  });
});

describe("Copiloto — confirma por la MISMA ruta de aplicación (executor compartido)", () => {
  it("/copilot/actions/confirm aplica un AiProposal generado por /ai/actions/run", async () => {
    const v = await api("POST", "/vehicles", adminToken, {
      plate: `CPU${runId.toString().slice(-4)}`,
      type: "IONAX",
      capacityKg: 530,
      capacityM3: 3,
      isElectric: true,
      batteryKwh: 11.52,
      nominalRangeKm: 130,
    });
    const o = await api("POST", "/orders", adminToken, {
      customerName: "Copiloto plan",
      customerPhone: "+573117770001",
      addressRaw: "Cl 72 # 10-34",
    });
    const run = await api("POST", "/ai/actions/optimize_routes/run", adminToken, {
      orderIds: [o.body.id],
      vehicleIds: [v.body.id],
      date: "2026-06-22",
      params: { depot: DEPOT },
    });
    expect(run.status).toBe(200);

    // Otro tenant no puede confirmarla (aislamiento, misma ruta de aplicación).
    const foreign = await api("POST", "/copilot/actions/confirm", otherToken, {
      proposalId: run.body.proposalId,
    });
    expect(foreign.status).toBe(404);

    // El dueño confirma por el endpoint del Copiloto → aplica igual que /ai/apply.
    const confirm = await api("POST", "/copilot/actions/confirm", adminToken, {
      proposalId: run.body.proposalId,
    });
    expect(confirm.status).toBe(200);
    expect(confirm.body.ok).toBe(true);

    const assigned = await prisma.order.count({
      where: { id: o.body.id, status: "ASSIGNED" },
    });
    expect(assigned).toBe(1);

    // Idempotencia compartida: reconfirmar devuelve 409.
    const again = await api("POST", "/copilot/actions/confirm", adminToken, {
      proposalId: run.body.proposalId,
    });
    expect(again.status).toBe(409);
  });

  it("/copilot/chat/stream responde 503 JSON cuando falta la API key (nunca un stream a medias)", async () => {
    // El guardia corre ANTES de abrir el stream: sin ANTHROPIC_API_KEY devuelve
    // un 503 NOT_CONFIGURED limpio que el panel web sabe explicar.
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const res = await api("POST", "/copilot/chat/stream", adminToken, {
        messages: [{ role: "user", content: "hola" }],
      });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("COPILOT_NOT_CONFIGURED");
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});
