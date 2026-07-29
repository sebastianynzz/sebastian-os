import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Revocación de JWT (MO-08): un logout real incrementa la versión de token del
 * usuario, invalidando los JWT ya emitidos — no basta con borrar el token en el
 * cliente. Prueba: token válido → /auth/me OK → /auth/logout → el MISMO token ya
 * no sirve (401 TOKEN_REVOKED), pero un re-login sí.
 */

const runId = Date.now();
const adminEmail = `logout+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let token: string;

async function api(method: "GET" | "POST", url: string, tok?: string, body?: unknown) {
  const res = await app.inject({
    method,
    url,
    headers: tok ? { authorization: `Bearer ${tok}` } : {},
    payload: body as object | undefined,
  });
  return { status: res.statusCode, body: res.json() };
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const reg = await api("POST", "/auth/register", undefined, {
    tenantName: "Logout Co",
    adminName: "Admin LO",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = reg.body.tenant.id;
  token = reg.body.token;
});

afterAll(async () => {
  if (tenantId) {
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  }
  await app.close();
  await prisma.$disconnect();
});

describe("Revocación de token (logout)", () => {
  it("el token sirve antes del logout", async () => {
    const me = await api("GET", "/auth/me", token);
    expect(me.status).toBe(200);
  });

  it("tras el logout, el MISMO token deja de servir (401)", async () => {
    const out = await api("POST", "/auth/logout", token);
    expect(out.status).toBe(200);
    expect(out.body.ok).toBe(true);

    const me = await api("GET", "/auth/me", token);
    expect(me.status).toBe(401);
    expect(me.body.code).toBe("TOKEN_REVOKED");
  });

  it("un re-login emite un token nuevo que sí sirve", async () => {
    const login = await api("POST", "/auth/login", undefined, {
      email: adminEmail,
      password: "moveos123",
    });
    expect(login.status).toBe(200);
    const me = await api("GET", "/auth/me", login.body.token);
    expect(me.status).toBe(200);
  });
});
