import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { resetModuleEntitlementCache } from "../plugins/entitlements.js";

/**
 * Servicios / SLA (D3): catálogo de promesas de entrega (precio por parada +
 * plazo SLA), su asignación a pedidos (single + portal) y el seguimiento del
 * incumplimiento — SLA_BREACH en el cockpit de excepciones y el informe por
 * cliente en analítica. Mutaciones solo ADMIN; tenant-scoped; sin COD.
 */
const runId = Date.now();
const adminEmail = `services+${runId}@test.moveos.co`;
const portalEmail = `servicescli+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;
let portalToken: string;
let clientId: string;
let serviceId: string;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function api(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: body as object | undefined,
  });
  // 204 (DELETE) llega sin cuerpo: no intentamos parsear JSON vacío.
  let parsed: any;
  try {
    parsed = res.body ? res.json() : undefined;
  } catch {
    parsed = undefined;
  }
  return { status: res.statusCode, body: parsed };
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  const reg = await api("POST", "/auth/register", undefined, {
    tenantName: "Services Co",
    adminName: "Admin",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = reg.body!.tenant.id;
  adminToken = reg.body!.token;

  // Analítica Pro habilitada para probar el informe de SLA (gated).
  await prisma.moduleEntitlement.upsert({
    where: { tenantId_moduleKey: { tenantId, moduleKey: "ANALYTICS_PRO" } },
    create: { tenantId, moduleKey: "ANALYTICS_PRO", enabled: true },
    update: { enabled: true },
  });
  // Escritura directa con Prisma: el caché TTL de entitlements no se entera.
  resetModuleEntitlementCache();

  // Negocio cliente + acceso al portal (para probar el alta con serviceId).
  const client = await api("POST", "/clients", adminToken, {
    name: "Comercio SLA",
    notifyChannel: "IN_APP",
    pickupAddressRaw: "Cra 9 # 60-15",
    pickupLat: 4.6463,
    pickupLng: -74.0628,
  });
  clientId = client.body!.id;
  await api("POST", `/clients/${clientId}/portal-access`, adminToken, {
    email: portalEmail,
    password: "moveos123",
  });
  const login = await api("POST", "/auth/login", undefined, {
    email: portalEmail,
    password: "moveos123",
  });
  portalToken = login.body!.token;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("Servicios / SLA (D3)", () => {
  it("CRUD de servicios (ADMIN)", async () => {
    const created = await api("POST", "/services", adminToken, {
      name: "Same Day",
      identifier: "SD",
      pricePerStopCop: 1000,
      completionDeadlineMin: 240,
    });
    expect(created.status).toBe(201);
    expect(created.body!.identifier).toBe("SD");
    serviceId = created.body!.id;

    const list = await api("GET", "/services", adminToken);
    expect(list.status).toBe(200);
    expect((list.body as unknown as { id: string }[]).some((s) => s.id === serviceId)).toBe(true);

    const patched = await api("PATCH", `/services/${serviceId}`, adminToken, {
      pricePerStopCop: 2500,
    });
    expect(patched.status).toBe(200);
    expect(patched.body!.pricePerStopCop).toBe(2500);
  });

  it("rechaza un identificador duplicado (409)", async () => {
    const dup = await api("POST", "/services", adminToken, {
      name: "Same Day 2",
      identifier: "SD",
      pricePerStopCop: 500,
      completionDeadlineMin: 120,
    });
    expect(dup.status).toBe(409);
  });

  it("un usuario del portal (CLIENT) no puede crear servicios (403)", async () => {
    const denied = await api("POST", "/services", portalToken, {
      name: "X",
      identifier: "X",
      pricePerStopCop: 0,
      completionDeadlineMin: 60,
    });
    expect(denied.status).toBe(403);
    expect(denied.body!.code).toBe("CLIENT_PORTAL_ONLY");
  });

  it("persiste serviceId al crear un pedido y lo expone en el listado", async () => {
    const order = await api("POST", "/orders", adminToken, {
      serviceId,
      clientId,
      customerName: "Destino Uno",
      customerPhone: "+573111111111",
      addressRaw: "Cra 13 # 54-20",
      lat: 4.6416,
      lng: -74.0639,
    });
    expect(order.status).toBe(201);
    expect(order.body!.serviceId).toBe(serviceId);

    const list = await api("GET", "/orders", adminToken);
    const found = (list.body as unknown as { id: string; service: { identifier: string } | null }[]).find(
      (o) => o.id === order.body!.id,
    );
    expect(found?.service?.identifier).toBe("SD");
  });

  it("rechaza un serviceId que no pertenece al tenant (400)", async () => {
    const bad = await api("POST", "/orders", adminToken, {
      serviceId: "svc-inexistente",
      customerName: "Destino Dos",
      customerPhone: "+573111111112",
      addressRaw: "Cra 1",
      lat: 4.6,
      lng: -74.06,
    });
    expect(bad.status).toBe(400);
  });

  it("levanta SLA_BREACH en el cockpit cuando la hora límite ya pasó", async () => {
    const order = await api("POST", "/orders", adminToken, {
      serviceId,
      clientId,
      customerName: "Destino Tarde",
      customerPhone: "+573111111113",
      addressRaw: "Cra 2",
      lat: 4.6,
      lng: -74.06,
    });
    // Atrasamos la creación 6 h: con plazo 240 min ya está vencido.
    await prisma.order.update({
      where: { id: order.body!.id },
      data: { createdAt: new Date(Date.now() - 6 * 3600_000) },
    });
    const exc = await api("GET", "/exceptions", adminToken);
    const items = (exc.body as unknown as { items: { type: string; severity: string; refs: { orderId?: string } }[] }).items;
    const sla = items.filter((i) => i.type === "SLA_BREACH");
    expect(sla.length).toBeGreaterThan(0);
    const mine = sla.find((i) => i.refs.orderId === order.body!.id);
    expect(mine?.severity).toBe("HIGH");
  });

  it("el informe de SLA por cliente cuenta incumplidos", async () => {
    const rep = await api("GET", "/analytics/sla-report", adminToken);
    expect(rep.status).toBe(200);
    const body = rep.body as unknown as {
      totals: { total: number; breached: number };
      byClient: { clientName: string; total: number }[];
    };
    expect(body.totals.total).toBeGreaterThanOrEqual(1);
    expect(body.totals.breached).toBeGreaterThanOrEqual(1);
    expect(body.byClient.some((r) => r.clientName === "Comercio SLA")).toBe(true);
  });

  it("el portal lista servicios activos y crea un envío con serviceId", async () => {
    const list = await api("GET", "/portal/services", portalToken);
    expect(list.status).toBe(200);
    expect((list.body as unknown as { id: string }[]).some((s) => s.id === serviceId)).toBe(true);

    const order = await api("POST", "/portal/orders", portalToken, {
      serviceId,
      customerName: "Consumidor Portal",
      customerPhone: "+573111111114",
      addressRaw: "Cl 72 # 10-34",
      pickupMode: "REGISTERED",
      weightKg: 1,
    });
    expect(order.status).toBe(201);
    const persisted = await prisma.order.findFirst({
      where: { tenantId, trackingNumber: order.body!.trackingNumber as string },
      select: { serviceId: true, clientId: true },
    });
    expect(persisted?.serviceId).toBe(serviceId);
    expect(persisted?.clientId).toBe(clientId);
  });

  it("elimina un servicio sin pedidos (204)", async () => {
    const tmp = await api("POST", "/services", adminToken, {
      name: "Temporal",
      identifier: "TMP",
      pricePerStopCop: 0,
      completionDeadlineMin: 60,
    });
    const del = await api("DELETE", `/services/${tmp.body!.id}`, adminToken);
    expect(del.status).toBe(204);
    const list = await api("GET", "/services", adminToken);
    expect((list.body as unknown as { id: string }[]).some((s) => s.id === tmp.body!.id)).toBe(false);
  });
});
