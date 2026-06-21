import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * SLA → cockpit de excepciones (D3b): un pedido con servicio cuyo plazo ya
 * venció (no entregado) aparece como excepción SLA_BREACH de severidad HIGH.
 */
const runId = Date.now();
const adminEmail = `sla+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;

async function api(
  method: "GET" | "POST",
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
    tenantName: "SLA Co",
    adminName: "Admin",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
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

describe("SLA → excepciones (D3b)", () => {
  it("un pedido vencido de su servicio aparece como SLA_BREACH (HIGH)", async () => {
    const svc = await api("POST", "/services", adminToken, {
      name: "Same Day",
      identifier: `SAME_${runId}`,
      pricePerStopCop: 8000,
      completionDeadlineMin: 60,
      stopType: "DELIVERY",
    });
    expect(svc.status).toBe(201);

    const order = await api("POST", "/orders", adminToken, {
      customerName: "Cliente SLA",
      customerPhone: "+573001110000",
      addressRaw: "Cra 7 # 32-10",
      serviceId: svc.body.id,
    });
    expect(order.status).toBe(201);
    expect(order.body.serviceId).toBe(svc.body.id);

    // Antedatar la creación 3 h: con plazo de 60 min, el SLA ya venció.
    await prisma.order.update({
      where: { id: order.body.id },
      data: { createdAt: new Date(Date.now() - 3 * 3600_000) },
    });

    const exc = await api("GET", "/exceptions", adminToken);
    expect(exc.status).toBe(200);
    const items = Array.isArray(exc.body) ? exc.body : exc.body.items;
    const sla = items.find(
      (i: { type: string; refs?: { orderId?: string } }) =>
        i.type === "SLA_BREACH" && i.refs?.orderId === order.body.id,
    );
    expect(sla).toBeTruthy();
    expect(sla.severity).toBe("HIGH");
  });
});
