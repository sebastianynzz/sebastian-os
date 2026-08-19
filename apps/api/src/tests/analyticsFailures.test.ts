import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { resetModuleEntitlementCache } from "../plugins/entitlements.js";

/**
 * Análisis de fallos (D6): /analytics/failures agrega los pedidos fallidos del
 * rango por motivo estandarizado. Gated por ANALYTICS_PRO. Tenant-scoped.
 */
const runId = Date.now();
const adminEmail = `failures+${runId}@test.moveos.co`;
let app: FastifyInstance;
let tenantId: string;
let adminToken: string;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function api(
  method: "GET" | "POST",
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
  return { status: res.statusCode, body: res.body ? res.json() : undefined };
}

async function failOrder(reason: string, status: "FAILED" | "REJECTED") {
  const order = await api("POST", "/orders", adminToken, {
    customerName: "Destino",
    customerPhone: "+573111111140",
    addressRaw: "Cra 13 # 54-20",
    lat: 4.64,
    lng: -74.06,
  });
  await prisma.order.update({
    where: { id: order.body.id },
    data: { status, failureReason: reason },
  });
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const reg = await api("POST", "/auth/register", undefined, {
    tenantName: "Failures Co",
    adminName: "Admin",
    city: "Bogotá",
    email: adminEmail,
    password: "dalego123",
  });
  tenantId = reg.body.tenant.id;
  adminToken = reg.body.token;
  await prisma.moduleEntitlement.upsert({
    where: { tenantId_moduleKey: { tenantId, moduleKey: "ANALYTICS_PRO" } },
    create: { tenantId, moduleKey: "ANALYTICS_PRO", enabled: true },
    update: { enabled: true },
  });
  // Escritura directa con Prisma: el caché TTL de entitlements no se entera.
  resetModuleEntitlementCache();
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("Análisis de fallos (D6)", () => {
  it("agrega los fallos por motivo", async () => {
    await failOrder("DIRECCION_ERRADA", "FAILED");
    await failOrder("DIRECCION_ERRADA", "FAILED");
    await failOrder("CLIENTE_AUSENTE", "REJECTED");

    const res = await api("GET", "/analytics/failures", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    const byReason: { reason: string; count: number }[] = res.body.byReason;
    expect(byReason.find((r) => r.reason === "DIRECCION_ERRADA")?.count).toBe(2);
    expect(byReason.find((r) => r.reason === "CLIENTE_AUSENTE")?.count).toBe(1);
    // El más frecuente va primero.
    expect(byReason[0]!.reason).toBe("DIRECCION_ERRADA");
    expect(Array.isArray(res.body.byDay)).toBe(true);
  });

  it("clasifica un motivo desconocido como OTRO", async () => {
    await failOrder("MOTIVO_RARO", "FAILED");
    const res = await api("GET", "/analytics/failures", adminToken);
    const otro = (res.body.byReason as { reason: string; count: number }[]).find(
      (r) => r.reason === "OTRO",
    );
    expect(otro?.count).toBe(1);
  });
});
