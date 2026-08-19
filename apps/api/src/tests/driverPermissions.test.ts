import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Permisos de la app del conductor (Tier 2 §10): política singleton por tenant
 * (app de navegación + qué puede hacer el conductor con las rutas). La LEE
 * cualquier usuario del tenant (incl. el conductor); solo ADMIN la edita. Sin
 * fila = la política por defecto (app "bloqueada"). Tenant-scoped.
 */
const runId = Date.now();
const adminEmail = `dperm+${runId}@test.moveos.co`;
const driverEmail = `dpermdrv+${runId}@test.moveos.co`;
const portalEmail = `dpermcli+${runId}@test.moveos.co`;
const otherAdminEmail = `dperm2+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let otherTenantId: string;
let adminToken: string;
let driverToken: string;
let portalToken: string;
let otherAdminToken: string;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function api(
  method: "GET" | "POST" | "PATCH",
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
    tenantName: "Driver Perms Co",
    adminName: "Admin",
    city: "Bogotá",
    email: adminEmail,
    password: "dalego123",
  });
  tenantId = reg.body!.tenant.id;
  adminToken = reg.body!.token;

  // Conductor con login (la app del conductor lee la política).
  await api("POST", "/drivers", adminToken, {
    name: "Conductor Perms",
    phone: "+573000000088",
    documentId: `88${runId}`.slice(0, 12),
    email: driverEmail,
    password: "dalego123",
  });
  driverToken = (
    await api("POST", "/auth/login", undefined, {
      email: driverEmail,
      password: "dalego123",
    })
  ).body.token;

  // Cliente del portal (rol CLIENT) para probar el guard de rol.
  const client = await api("POST", "/clients", adminToken, {
    name: "Comercio DP",
    notifyChannel: "IN_APP",
  });
  await api("POST", `/clients/${client.body.id}/portal-access`, adminToken, {
    email: portalEmail,
    password: "dalego123",
  });
  portalToken = (
    await api("POST", "/auth/login", undefined, {
      email: portalEmail,
      password: "dalego123",
    })
  ).body.token;

  // Segundo tenant para verificar aislamiento.
  const reg2 = await api("POST", "/auth/register", undefined, {
    tenantName: "Otro Tenant DP",
    adminName: "Admin2",
    city: "Medellín",
    email: otherAdminEmail,
    password: "dalego123",
  });
  otherTenantId = reg2.body!.tenant.id;
  otherAdminToken = reg2.body!.token;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  if (otherTenantId)
    await prisma.tenant.delete({ where: { id: otherTenantId } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("Permisos de la app del conductor (Tier 2 §10)", () => {
  it("sin fila devuelve la política por defecto (app bloqueada)", async () => {
    const res = await api("GET", "/controls/driver-permissions", adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      navApp: "INTERNAL_GMAPS",
      allowEditDispatcherRoutes: false,
      allowCreateRoutes: false,
      allowEditStartedRoutes: false,
    });
  });

  it("el conductor puede LEER la política (su app la consulta)", async () => {
    const res = await api("GET", "/controls/driver-permissions", driverToken);
    expect(res.status).toBe(200);
    expect(res.body.navApp).toBe("INTERNAL_GMAPS");
  });

  it("ADMIN actualiza la política (upsert) y GET la refleja", async () => {
    const patch = await api("PATCH", "/controls/driver-permissions", adminToken, {
      navApp: "WAZE",
      allowCreateRoutes: true,
      allowEditStartedRoutes: true,
    });
    expect(patch.status).toBe(200);
    expect(patch.body.navApp).toBe("WAZE");
    expect(patch.body.allowCreateRoutes).toBe(true);
    expect(patch.body.allowEditStartedRoutes).toBe(true);
    // No enviado → conserva el valor por defecto.
    expect(patch.body.allowEditDispatcherRoutes).toBe(false);

    const get = await api("GET", "/controls/driver-permissions", driverToken);
    expect(get.body.navApp).toBe("WAZE");
    expect(get.body.allowCreateRoutes).toBe(true);
  });

  it("el conductor NO puede editar la política (403)", async () => {
    const res = await api("PATCH", "/controls/driver-permissions", driverToken, {
      navApp: "GOOGLE",
    });
    expect(res.status).toBe(403);
  });

  it("el rol CLIENT del portal NO puede editar la política (403)", async () => {
    const res = await api("PATCH", "/controls/driver-permissions", portalToken, {
      navApp: "GOOGLE",
    });
    expect(res.status).toBe(403);
  });

  it("rechaza una app de navegación inválida (400)", async () => {
    const res = await api("PATCH", "/controls/driver-permissions", adminToken, {
      navApp: "MAPQUEST",
    });
    expect(res.status).toBe(400);
  });

  it("aislamiento: el otro tenant conserva su política por defecto", async () => {
    const res = await api("GET", "/controls/driver-permissions", otherAdminToken);
    expect(res.body.navApp).toBe("INTERNAL_GMAPS");
    expect(res.body.allowCreateRoutes).toBe(false);
  });
});
