import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Vistas guardadas del panel: filtros con nombre, PRIVADAS por usuario y tenant.
 * Re-guardar con el mismo nombre actualiza (upsert); otro tenant no las ve ni
 * las borra.
 */

const runId = Date.now();
const adminEmail = `sv-admin+${runId}@test.moveos.co`;
const otherEmail = `sv-other+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let otherTenantId: string;
let adminToken: string;
let otherToken: string;
let viewId = "";

async function api(
  method: "GET" | "POST" | "DELETE",
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

  const a = await api("POST", "/auth/register", undefined, {
    tenantName: "Test Vistas A",
    adminName: "Admin A",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = a.body.tenant.id;
  adminToken = a.body.token;

  const b = await api("POST", "/auth/register", undefined, {
    tenantName: "Test Vistas B",
    adminName: "Admin B",
    city: "Bogotá",
    email: otherEmail,
    password: "moveos123",
  });
  otherTenantId = b.body.tenant.id;
  otherToken = b.body.token;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  if (otherTenantId) await prisma.tenant.delete({ where: { id: otherTenantId } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("vistas guardadas — por usuario + tenant", () => {
  it("crea vistas y las lista por página", async () => {
    const v1 = await api("POST", "/saved-views", adminToken, {
      page: "pedidos",
      name: "Pendientes",
      filters: { status: "PENDING" },
    });
    expect(v1.status).toBe(200);
    viewId = v1.body.id;
    await api("POST", "/saved-views", adminToken, {
      page: "pedidos",
      name: "Bogotá",
      filters: { q: "bogota" },
    });

    const list = await api("GET", "/saved-views?page=pedidos", adminToken);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);

    // El filtro por página aísla: otra página no devuelve estas vistas.
    const otherPage = await api("GET", "/saved-views?page=rutas", adminToken);
    expect(otherPage.body).toHaveLength(0);
  });

  it("re-guardar con el mismo nombre actualiza (upsert, no duplica)", async () => {
    const again = await api("POST", "/saved-views", adminToken, {
      page: "pedidos",
      name: "Pendientes",
      filters: { status: "DELIVERED" },
    });
    expect(again.status).toBe(200);
    expect(again.body.filters.status).toBe("DELIVERED");

    const list = await api("GET", "/saved-views?page=pedidos", adminToken);
    expect(list.body).toHaveLength(2); // sigue habiendo 2, no 3
  });

  it("AISLAMIENTO: otro tenant/usuario no ve ni borra las vistas", async () => {
    const theirs = await api("GET", "/saved-views?page=pedidos", otherToken);
    expect(theirs.body).toHaveLength(0);

    const del = await api("DELETE", `/saved-views/${viewId}`, otherToken);
    expect(del.status).toBe(404);
  });

  it("el dueño borra su vista", async () => {
    const del = await api("DELETE", `/saved-views/${viewId}`, adminToken);
    expect(del.status).toBe(200);
    const list = await api("GET", "/saved-views?page=pedidos", adminToken);
    expect(list.body).toHaveLength(1);
  });
});
