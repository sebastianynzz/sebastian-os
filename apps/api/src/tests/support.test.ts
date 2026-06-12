import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Consola de soporte (A4) + salud de integraciones (A2) + asistente de
 * onboarding (A3). Lo crítico: la impersonación emite un token de tenant
 * REAL (scoping intacto), queda auditada, y solo el plano de plataforma
 * puede usar estos endpoints.
 */

const runId = Date.now();
const opsEmail = `support-ops+${runId}@test.moveos.co`;
const adminEmail = `support-admin+${runId}@test.moveos.co`;
const provisionedEmail = `support-prov+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let provisionedTenantId: string | null = null;
let tenantToken: string;
let platformToken: string;

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

  await prisma.platformAdmin.create({
    data: {
      email: opsEmail,
      name: "Soporte Test",
      passwordHash: await bcrypt.hash("moveos123", 10),
    },
  });
  const login = await api("POST", "/platform/auth/login", undefined, {
    email: opsEmail,
    password: "moveos123",
  });
  platformToken = login.body.token;

  const reg = await api("POST", "/auth/register", undefined, {
    tenantName: "Test Soporte",
    adminName: "Admin Soporte",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = reg.body.tenant.id;
  tenantToken = reg.body.token;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  if (provisionedTenantId) {
    await prisma.tenant.delete({ where: { id: provisionedTenantId } }).catch(() => {});
  }
  await prisma.platformAdmin.deleteMany({ where: { email: opsEmail } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("consola de soporte + salud + onboarding", () => {
  it("impersona al ADMIN del tenant con token corto y queda auditado", async () => {
    const res = await api(
      "POST",
      `/platform/tenants/${tenantId}/impersonate`,
      platformToken,
      {},
    );
    expect(res.status).toBe(200);
    expect(res.body.expiresInMin).toBe(30);
    expect(res.body.user.email).toBe(adminEmail);

    // El token de soporte opera el plano del tenant con scoping normal.
    const orders = await api("GET", "/orders", res.body.token);
    expect(orders.status).toBe(200);

    // Y la emisión quedó en la bitácora de plataforma.
    const audit = await prisma.platformAuditLog.findFirst({
      where: { action: "IMPERSONATE", targetTenantId: tenantId },
    });
    expect(audit).not.toBeNull();
    expect(audit!.adminEmail).toBe(opsEmail);
  });

  it("un token de tenant NO puede impersonar ni leer la salud", async () => {
    const imp = await api(
      "POST",
      `/platform/tenants/${tenantId}/impersonate`,
      tenantToken,
      {},
    );
    expect(imp.status).toBe(403);

    const health = await api("GET", "/platform/integrations/health", tenantToken);
    expect(health.status).toBe(403);
  });

  it("la salud de integraciones reporta la base de datos OK", async () => {
    const res = await api(
      "GET",
      "/platform/integrations/health?refresh=1",
      platformToken,
    );
    expect(res.status).toBe(200);
    const db = res.body.results.find(
      (r: { key: string }) => r.key === "database",
    );
    expect(db.status).toBe("OK");
    expect(db.latencyMs).toBeGreaterThanOrEqual(0);
    // Sin claves en el entorno de test: reportadas como no configuradas.
    const push = res.body.results.find(
      (r: { key: string }) => r.key === "web_push",
    );
    expect(push.status).toBe("NOT_CONFIGURED");
  });

  it("el asistente aprovisiona con selección explícita de módulos (núcleo siempre)", async () => {
    const res = await api("POST", "/platform/tenants", platformToken, {
      name: `Wizard Tenant ${runId}`,
      businessModel: "SAAS",
      plan: "FREE",
      adminName: "Admin Wizard",
      adminEmail: provisionedEmail,
      adminPassword: "moveos123",
      modules: ["TELEMATICS"],
    });
    expect(res.status).toBe(201);
    provisionedTenantId = res.body.tenant.id;

    const entitlements = await prisma.moduleEntitlement.findMany({
      where: { tenantId: res.body.tenant.id },
    });
    const byKey = new Map(entitlements.map((e) => [e.moduleKey, e.enabled]));
    expect(byKey.get("TELEMATICS")).toBe(true);
    expect(byKey.get("EV_MANAGEMENT")).toBe(true); // núcleo: siempre activo
    // La selección explícita reemplaza los default del catálogo.
    expect(byKey.get("ROUTE_OPTIMIZATION")).toBe(false);
    expect(byKey.get("SAFETY")).toBe(false);
  });
});
