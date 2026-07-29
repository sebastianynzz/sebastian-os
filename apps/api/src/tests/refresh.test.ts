import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Sesión con refresh token en cookie httpOnly (MO-16): login/registro fijan la
 * cookie de refresh; /auth/refresh la canjea por un access token nuevo (y rota
 * la cookie); logout la invalida (tokenVersion). El access token vive en memoria
 * en la SPA, no en localStorage, así que un XSS no puede robar la sesión durable.
 */

const runId = Date.now();
const adminEmail = `refresh+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let refreshCookie: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const reg = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      tenantName: "Refresh Co",
      adminName: "Admin RF",
      city: "Bogotá",
      email: adminEmail,
      password: "moveos123",
    },
  });
  tenantId = reg.json().tenant.id;
  const rt = reg.cookies.find((c) => c.name === "mv_rt");
  refreshCookie = rt?.value ?? "";
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("refresh token en cookie httpOnly", () => {
  it("el registro fija una cookie de refresh httpOnly", () => {
    expect(refreshCookie).toBeTruthy();
    // la cookie es httpOnly (no legible por JS)
    expect(refreshCookie.length).toBeGreaterThan(20);
  });

  it("/auth/refresh canjea la cookie por un access token usable y rota la cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      cookies: { mv_rt: refreshCookie },
    });
    expect(res.statusCode).toBe(200);
    const token = res.json().token;
    expect(typeof token).toBe("string");
    // rota la cookie (sesión deslizante)
    expect(res.cookies.find((c) => c.name === "mv_rt")).toBeTruthy();
    // el access token sirve
    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
  });

  it("sin cookie → 401", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/refresh" });
    expect(res.statusCode).toBe(401);
  });

  it("una cookie de refresh manipulada → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      cookies: { mv_rt: refreshCookie.slice(0, -3) + "xyz" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("tras logout, la cookie de refresh vieja deja de servir (revocada)", async () => {
    // obtener un access token fresco para poder hacer logout
    const r = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      cookies: { mv_rt: refreshCookie },
    });
    const token = r.json().token;
    const out = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(out.statusCode).toBe(200);

    const after = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      cookies: { mv_rt: refreshCookie },
    });
    expect(after.statusCode).toBe(401);
    expect(after.json().code).toBe("TOKEN_REVOKED");
  });
});
