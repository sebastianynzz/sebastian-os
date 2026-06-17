import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Depósitos / multi-depot (D4): CRUD del catálogo de depósitos, invariante de
 * un único principal por tenant (al crear/editar como principal se desmarca el
 * resto; al borrar el principal se promueve otro), mutaciones solo ADMIN y
 * aislamiento (el rol CLIENT del portal no puede mutar). Tenant-scoped.
 */
const runId = Date.now();
const adminEmail = `depots+${runId}@test.moveos.co`;
const portalEmail = `depotscli+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;
let portalToken: string;

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
    tenantName: "Depots Co",
    adminName: "Admin",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = reg.body.tenant.id;
  adminToken = reg.body.token;

  const client = await api("POST", "/clients", adminToken, {
    name: "Comercio Depot",
    notifyChannel: "IN_APP",
  });
  await api("POST", `/clients/${client.body.id}/portal-access`, adminToken, {
    email: portalEmail,
    password: "moveos123",
  });
  const login = await api("POST", "/auth/login", undefined, {
    email: portalEmail,
    password: "moveos123",
  });
  portalToken = login.body.token;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("Depósitos / multi-depot (D4)", () => {
  let mainId: string;
  let secondId: string;

  it("el primer depósito queda como principal automáticamente", async () => {
    const res = await api("POST", "/depots", adminToken, {
      name: "Central",
      address: "Cra 30 # 1-50",
      lat: 4.6486,
      lng: -74.0628,
    });
    expect(res.status).toBe(201);
    expect(res.body.isMain).toBe(true);
    mainId = res.body.id;
  });

  it("un segundo depósito no principal coexiste; el listado pone el principal primero", async () => {
    const res = await api("POST", "/depots", adminToken, {
      name: "Norte",
      lat: 4.71,
      lng: -74.07,
    });
    expect(res.status).toBe(201);
    expect(res.body.isMain).toBe(false);
    secondId = res.body.id;

    const list = await api("GET", "/depots", adminToken);
    expect(list.body.length).toBe(2);
    expect(list.body[0].id).toBe(mainId);
  });

  it("marcar otro como principal desmarca al anterior (uno por tenant)", async () => {
    const res = await api("PATCH", `/depots/${secondId}`, adminToken, { isMain: true });
    expect(res.status).toBe(200);
    expect(res.body.isMain).toBe(true);

    const mains = await prisma.depot.findMany({ where: { tenantId, isMain: true } });
    expect(mains.length).toBe(1);
    expect(mains[0]!.id).toBe(secondId);
  });

  it("el rol CLIENT del portal no puede crear depósitos (403)", async () => {
    const denied = await api("POST", "/depots", portalToken, {
      name: "X",
      lat: 4.6,
      lng: -74.0,
    });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("CLIENT_PORTAL_ONLY");
  });

  it("borrar el principal promueve a otro depósito", async () => {
    const del = await api("DELETE", `/depots/${secondId}`, adminToken);
    expect(del.status).toBe(204);
    const mains = await prisma.depot.findMany({ where: { tenantId, isMain: true } });
    expect(mains.length).toBe(1);
    expect(mains[0]!.id).toBe(mainId);
  });

  it("404 al editar/borrar un depósito inexistente", async () => {
    expect((await api("PATCH", "/depots/nope", adminToken, { name: "Z" })).status).toBe(404);
    expect((await api("DELETE", "/depots/nope", adminToken)).status).toBe(404);
  });
});
