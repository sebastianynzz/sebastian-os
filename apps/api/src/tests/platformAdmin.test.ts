import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Editabilidad del panel de plataforma: edición de tenant (datos + modelo de
 * negocio), presets de módulos por modelo de negocio, gestión de usuarios del
 * equipo (crear/rol/reset/eliminar con guarda de último ADMIN) y bitácora de
 * auditoría de todas las mutaciones.
 */

const runId = Date.now();
const opsEmail = `pfa-ops+${runId}@test.moveos.co`;
const tenantAdminEmail = `pfa-admin+${runId}@test.moveos.co`;
const dispatcherEmail = `pfa-dispatcher+${runId}@test.moveos.co`;
const faasAdminEmail = `pfa-faas+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let tenantToken: string;
let platformToken: string;
let faasTenantId: string;
let dispatcherId: string;

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

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  await prisma.platformAdmin.create({
    data: {
      email: opsEmail,
      name: "Ops Editabilidad",
      passwordHash: await bcrypt.hash("dalego123", 10),
    },
  });
  const login = await api("POST", "/platform/auth/login", undefined, {
    email: opsEmail,
    password: "dalego123",
  });
  platformToken = login.body.token;

  const reg = await api("POST", "/auth/register", undefined, {
    tenantName: "Test Editable",
    adminName: "Admin Editable",
    city: "Bogotá",
    email: tenantAdminEmail,
    password: "dalego123",
  });
  tenantId = reg.body.tenant.id;
  tenantToken = reg.body.token;
});

afterAll(async () => {
  for (const id of [tenantId, faasTenantId]) {
    if (id) await prisma.tenant.delete({ where: { id } }).catch(() => {});
  }
  await prisma.platformAdmin.deleteMany({ where: { email: opsEmail } }).catch(() => {});
  await prisma.platformAuditLog
    .deleteMany({ where: { targetTenantId: { in: [tenantId, faasTenantId] } } })
    .catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("edición del tenant desde la plataforma", () => {
  it("PATCH actualiza nombre, ciudad y modelo de negocio; GET lo refleja", async () => {
    const res = await api("PATCH", `/platform/tenants/${tenantId}`, platformToken, {
      name: "Editable S.A.S.",
      city: "Medellín",
      businessModel: "LOGISTICS_3PL",
    });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Editable S.A.S.");
    expect(res.body.businessModel).toBe("LOGISTICS_3PL");

    const detail = await api("GET", `/platform/tenants/${tenantId}`, platformToken);
    expect(detail.body.name).toBe("Editable S.A.S.");
    expect(detail.body.city).toBe("Medellín");
    expect(detail.body.businessModel).toBe("LOGISTICS_3PL");
    expect(detail.body.operatorType).toBeDefined();
  });

  it("la edición queda auditada con su diff", async () => {
    const audit = await api(
      "GET",
      `/platform/audit?tenantId=${tenantId}`,
      platformToken,
    );
    expect(audit.status).toBe(200);
    const update = audit.body.entries.find(
      (e: { action: string }) => e.action === "TENANT_UPDATE",
    );
    expect(update).toBeDefined();
    expect(update.adminEmail).toBe(opsEmail);
    expect(update.details.businessModel.despues).toBe("LOGISTICS_3PL");
  });
});

describe("presets de módulos por modelo de negocio", () => {
  it("aprovisionar con FAAS enciende telemática, EV, seguridad y analítica", async () => {
    const res = await api("POST", "/platform/tenants", platformToken, {
      name: `Cliente FaaS Preset ${runId}`,
      city: "Bogotá",
      plan: "PRO",
      businessModel: "FAAS",
      adminName: "Admin FaaS",
      adminEmail: faasAdminEmail,
      adminPassword: "dalego123",
    });
    expect(res.status).toBe(201);
    expect(res.body.tenant.businessModel).toBe("FAAS");
    faasTenantId = res.body.tenant.id;

    const detail = await api(
      "GET",
      `/platform/tenants/${faasTenantId}`,
      platformToken,
    );
    const enabled = new Map(
      detail.body.modules.map((m: { key: string; enabled: boolean }) => [
        m.key,
        m.enabled,
      ]),
    );
    for (const key of ["ROUTE_OPTIMIZATION", "TELEMATICS", "EV_MANAGEMENT", "SAFETY", "ANALYTICS_PRO"]) {
      expect(enabled.get(key), key).toBe(true);
    }
    expect(enabled.get("COMPLIANCE_RNDC")).toBe(false);

    const provision = await api(
      "GET",
      `/platform/audit?tenantId=${faasTenantId}`,
      platformToken,
    );
    expect(
      provision.body.entries.some(
        (e: { action: string }) => e.action === "TENANT_PROVISION",
      ),
    ).toBe(true);
  });
});

describe("usuarios del equipo del tenant", () => {
  it("GUARDA DE FUGA: un token de tenant no puede usar /users (403)", async () => {
    const res = await api(
      "GET",
      `/platform/tenants/${tenantId}/users`,
      tenantToken,
    );
    expect(res.status).toBe(403);
  });

  it("lista el staff y crea un DISPATCHER que puede iniciar sesión", async () => {
    const list = await api(
      "GET",
      `/platform/tenants/${tenantId}/users`,
      platformToken,
    );
    expect(list.status).toBe(200);
    expect(list.body.some((u: { email: string }) => u.email === tenantAdminEmail)).toBe(true);

    const created = await api(
      "POST",
      `/platform/tenants/${tenantId}/users`,
      platformToken,
      {
        name: "Despachador Test",
        email: dispatcherEmail,
        role: "DISPATCHER",
        password: "dalego123",
      },
    );
    expect(created.status).toBe(201);
    dispatcherId = created.body.id;

    const login = await api("POST", "/auth/login", undefined, {
      email: dispatcherEmail,
      password: "dalego123",
    });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe("DISPATCHER");
  });

  it("resetea la contraseña: la vieja deja de servir, la nueva funciona", async () => {
    const reset = await api(
      "PATCH",
      `/platform/tenants/${tenantId}/users/${dispatcherId}`,
      platformToken,
      { newPassword: "nuevaClave123" },
    );
    expect(reset.status).toBe(200);

    const oldLogin = await api("POST", "/auth/login", undefined, {
      email: dispatcherEmail,
      password: "dalego123",
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await api("POST", "/auth/login", undefined, {
      email: dispatcherEmail,
      password: "nuevaClave123",
    });
    expect(newLogin.status).toBe(200);

    // El reset queda auditado sin la contraseña.
    const audit = await api(
      "GET",
      `/platform/audit?tenantId=${tenantId}`,
      platformToken,
    );
    const entry = audit.body.entries.find(
      (e: { action: string }) => e.action === "USER_RESET_PASSWORD",
    );
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry.details)).not.toContain("nuevaClave123");
  });

  it("no se puede degradar ni eliminar al último ADMIN", async () => {
    const list = await api(
      "GET",
      `/platform/tenants/${tenantId}/users`,
      platformToken,
    );
    const admin = list.body.find(
      (u: { email: string }) => u.email === tenantAdminEmail,
    );

    const demote = await api(
      "PATCH",
      `/platform/tenants/${tenantId}/users/${admin.id}`,
      platformToken,
      { role: "DISPATCHER" },
    );
    expect(demote.status).toBe(400);

    const del = await api(
      "DELETE",
      `/platform/tenants/${tenantId}/users/${admin.id}`,
      platformToken,
    );
    expect(del.status).toBe(400);
  });

  it("elimina al dispatcher y lo audita", async () => {
    const del = await api(
      "DELETE",
      `/platform/tenants/${tenantId}/users/${dispatcherId}`,
      platformToken,
    );
    expect(del.status).toBe(200);

    const login = await api("POST", "/auth/login", undefined, {
      email: dispatcherEmail,
      password: "nuevaClave123",
    });
    expect(login.status).toBe(401);

    const audit = await api(
      "GET",
      `/platform/audit?tenantId=${tenantId}`,
      platformToken,
    );
    expect(
      audit.body.entries.some(
        (e: { action: string }) => e.action === "USER_DELETE",
      ),
    ).toBe(true);
  });
});

describe("series de tiempo de plataforma", () => {
  it("la serie por tenant y la agregada tienen la forma esperada", async () => {
    const perTenant = await api(
      "GET",
      `/platform/metrics/timeseries?tenantId=${tenantId}`,
      platformToken,
    );
    expect(perTenant.status).toBe(200);
    expect(perTenant.body.tenantId).toBe(tenantId);
    expect(Array.isArray(perTenant.body.days)).toBe(true);
    expect(perTenant.body.days.length).toBe(30); // rango por defecto

    const platform = await api(
      "GET",
      "/platform/metrics/timeseries",
      platformToken,
    );
    expect(platform.status).toBe(200);
    expect(Array.isArray(platform.body.days)).toBe(true);
  });

  it("acepta un rango explícito from/to y devuelve esa cantidad de días con successRate", async () => {
    const today = new Date(Date.now() - 5 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    const fromD = new Date(`${today}T12:00:00Z`);
    fromD.setUTCDate(fromD.getUTCDate() - 6); // 7 días inclusive
    const from = fromD.toISOString().slice(0, 10);

    const res = await api(
      "GET",
      `/platform/metrics/timeseries?from=${from}&to=${today}&tenantId=${tenantId}`,
      platformToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.from).toBe(from);
    expect(res.body.to).toBe(today);
    expect(res.body.days.length).toBe(7);
    // El drill del frontend depende de successRate por día (null o número).
    expect(res.body.days[0]).toHaveProperty("successRate");
  });

  it("rango inválido (from > to) → 400", async () => {
    const res = await api(
      "GET",
      "/platform/metrics/timeseries?from=2026-02-10&to=2026-02-01",
      platformToken,
    );
    expect(res.status).toBe(400);
  });

  it("drill a un tenant inexistente → 404", async () => {
    const res = await api(
      "GET",
      "/platform/metrics/timeseries?tenantId=no-existe-xyz",
      platformToken,
    );
    expect(res.status).toBe(404);
  });

  it("exporta la serie como CSV con encabezado y tipo text/csv", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/platform/metrics/timeseries/export?tenantId=${tenantId}`,
      headers: { authorization: `Bearer ${platformToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body).toContain("fecha,creados,entregados");
  });
});

describe("filtros y exportación de auditoría", () => {
  it("filtra por acción y solo devuelve esa acción", async () => {
    const res = await api(
      "GET",
      "/platform/audit?action=TENANT_UPDATE",
      platformToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBeGreaterThan(0);
    expect(
      res.body.entries.every((e: { action: string }) => e.action === "TENANT_UPDATE"),
    ).toBe(true);
  });

  it("busca por operador (q) sobre el email del admin", async () => {
    const res = await api(
      "GET",
      `/platform/audit?q=${encodeURIComponent(opsEmail)}`,
      platformToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBeGreaterThan(0);
    expect(
      res.body.entries.every((e: { adminEmail: string }) => e.adminEmail === opsEmail),
    ).toBe(true);
  });

  it("rango de fechas futuro → sin resultados", async () => {
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    const res = await api(
      "GET",
      `/platform/audit?from=${tomorrow}`,
      platformToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(0);
  });

  it("exporta CSV con encabezado y tipo text/csv", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/platform/audit/export?action=TENANT_UPDATE",
      headers: { authorization: `Bearer ${platformToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body).toContain("fecha,accion,operador,tenant,usuario,detalle");
  });
});
