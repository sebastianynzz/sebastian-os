import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Panel del operador de plataforma + seguridad multi-plano.
 *
 * Lo más importante: un token de plataforma NO debe poder leer rutas de
 * tenant (fuga de datos por filtro `undefined` en Prisma) y un token de
 * tenant NO debe poder usar /platform. Ambos se prueban explícitamente.
 */

const runId = Date.now();
const adminEmail = `pf-tenant+${runId}@test.moveos.co`;
const opsEmail = `pf-ops+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
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
      name: "Ops Test",
      passwordHash: await bcrypt.hash("moveos123", 10),
    },
  });

  const reg = await api("POST", "/auth/register", undefined, {
    tenantName: "Test Platform Tenant",
    adminName: "Admin",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = reg.body.tenant.id;
  tenantToken = reg.body.token;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.platformAdmin.deleteMany({ where: { email: opsEmail } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("panel de plataforma + seguridad de planos", () => {
  it("el operador inicia sesión; contraseña mala → 401", async () => {
    const bad = await api("POST", "/platform/auth/login", undefined, {
      email: opsEmail,
      password: "incorrecta",
    });
    expect(bad.status).toBe(401);

    const ok = await api("POST", "/platform/auth/login", undefined, {
      email: opsEmail,
      password: "moveos123",
    });
    expect(ok.status).toBe(200);
    platformToken = ok.body.token;
  });

  it("GUARDA DE FUGA: un token de plataforma NO puede leer /orders (401)", async () => {
    const res = await api("GET", "/orders", platformToken);
    expect(res.status).toBe(401);
  });

  it("GUARDA DE FUGA: un token de tenant NO puede usar /platform (403)", async () => {
    const res = await api("GET", "/platform/tenants", tenantToken);
    expect(res.status).toBe(403);
  });

  it("sin token, /platform exige autenticación (401)", async () => {
    const res = await api("GET", "/platform/tenants");
    expect(res.status).toBe(401);
  });

  it("lista tenants con conteos de uso", async () => {
    const res = await api("GET", "/platform/tenants", platformToken);
    expect(res.status).toBe(200);
    const t = res.body.find((x: { id: string }) => x.id === tenantId);
    expect(t).toBeDefined();
    expect(t.counts.users).toBeGreaterThanOrEqual(1);
    expect(t.plan).toBe("FREE");
  });

  it("override de módulo: apagar TELEMATICS bloquea su API y reactivar la habilita", async () => {
    const off = await api("PATCH", `/platform/tenants/${tenantId}/modules/TELEMATICS`, platformToken, {
      enabled: false,
    });
    expect(off.status).toBe(200);

    const blocked = await api("GET", "/telematics/vehicles/live", tenantToken);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("MODULE_NOT_ENABLED");

    const on = await api("PATCH", `/platform/tenants/${tenantId}/modules/TELEMATICS`, platformToken, {
      enabled: true,
    });
    expect(on.status).toBe(200);
    const allowed = await api("GET", "/telematics/vehicles/live", tenantToken);
    expect(allowed.status).toBe(200);
  });

  it("suspender bloquea el login del tenant Y los tokens existentes; reactivar restaura", async () => {
    const suspend = await api("PATCH", `/platform/tenants/${tenantId}`, platformToken, {
      status: "SUSPENDED",
    });
    expect(suspend.status).toBe(200);

    // Login bloqueado.
    const login = await api("POST", "/auth/login", undefined, {
      email: adminEmail,
      password: "moveos123",
    });
    expect(login.status).toBe(403);
    expect(login.body.code).toBe("TENANT_SUSPENDED");

    // Token existente bloqueado (caché invalidada al suspender).
    const withToken = await api("GET", "/orders", tenantToken);
    expect(withToken.status).toBe(403);
    expect(withToken.body.code).toBe("TENANT_SUSPENDED");

    // Reactivar.
    const reactivate = await api("PATCH", `/platform/tenants/${tenantId}`, platformToken, {
      status: "ACTIVE",
    });
    expect(reactivate.status).toBe(200);
    const after = await api("GET", "/orders", tenantToken);
    expect(after.status).toBe(200);
  });

  it("métricas tienen la forma esperada", async () => {
    const res = await api("GET", "/platform/metrics", platformToken);
    expect(res.status).toBe(200);
    expect(res.body.tenants.total).toBeGreaterThanOrEqual(1);
    expect(res.body.moduleAdoption).toHaveLength(8);
    expect(Array.isArray(res.body.orders.byDay)).toBe(true);
  });

  describe("fleet-as-a-service: aprovisionar sub-operador", () => {
    let subTenantId: string;
    const subAdminEmail = `sub-admin+${runId}@test.moveos.co`;

    it("la plataforma crea un tenant SUB_OPERATOR con su admin", async () => {
      const res = await api("POST", "/platform/tenants", platformToken, {
        name: `Cliente FaaS ${runId}`,
        city: "Bogotá",
        plan: "PRO",
        operatorType: "SUB_OPERATOR",
        parentTenantId: tenantId, // MOVE como matriz
        adminName: "Admin Cliente",
        adminEmail: subAdminEmail,
        adminPassword: "moveos123",
      });
      expect(res.status).toBe(201);
      expect(res.body.tenant.operatorType).toBe("SUB_OPERATOR");
      expect(res.body.tenant.parentTenantId).toBe(tenantId);
      subTenantId = res.body.tenant.id;
    });

    it("el admin del sub-operador puede iniciar sesión y opera AISLADO", async () => {
      const login = await api("POST", "/auth/login", undefined, {
        email: subAdminEmail,
        password: "moveos123",
      });
      expect(login.status).toBe(200);
      const subToken = login.body.token;
      // Aislamiento: el sub-operador no ve pedidos del tenant matriz.
      const orders = await api("GET", "/orders", subToken);
      expect(orders.status).toBe(200);
      expect(orders.body).toHaveLength(0);
    });

    it("la plataforma asigna un vehículo de MOVE (ownerTenantId) al sub-operador", async () => {
      const res = await api(
        "POST",
        `/platform/tenants/${subTenantId}/vehicles`,
        platformToken,
        {
          plate: "FAS99E",
          type: "RAP_MOVE_LIGHT",
          capacityKg: 20,
          isElectric: true,
          batteryKwh: 4,
          nominalRangeKm: 80,
          ownerTenantId: tenantId, // MOVE es el dueño
        },
      );
      expect(res.status).toBe(201);
      expect(res.body.tenantId).toBe(subTenantId); // lo opera el sub-operador
      expect(res.body.ownerTenantId).toBe(tenantId); // lo posee MOVE
    });

    it("la flota cruzada del dueño aparece en /platform/tenants/fleet/owned", async () => {
      const res = await api("GET", "/platform/tenants/fleet/owned", platformToken);
      expect(res.status).toBe(200);
      const mine = res.body.find((v: { plate: string }) => v.plate === "FAS99E");
      expect(mine).toBeDefined();
      expect(mine.operatedBy.id).toBe(subTenantId);
      expect(mine.ownerTenantId).toBe(tenantId);
    });

    afterAll(async () => {
      if (subTenantId) {
        await prisma.tenant.delete({ where: { id: subTenantId } }).catch(() => {});
      }
    });
  });
});
