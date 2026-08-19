import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Prueba del webhook del comercio antes de guardarlo: /clients/test-webhook
 * valida la URL y reporta si responde, sin tumbar la UI. (B2B: el webhook es
 * del negocio cliente, nunca del consumidor.)
 */

const runId = Date.now();
const adminEmail = `wh+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;

async function api(method: "POST", url: string, token?: string, body?: unknown) {
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
    tenantName: "Webhook Co",
    adminName: "Admin WH",
    city: "Bogotá",
    email: adminEmail,
    password: "dalego123",
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

describe("POST /clients/test-webhook", () => {
  it("rechaza una URL inválida con 400", async () => {
    const res = await api("POST", "/clients/test-webhook", adminToken, {
      webhookUrl: "no-es-una-url",
    });
    expect(res.status).toBe(400);
  });

  it("reporta ok:false cuando la URL no responde (sin lanzar)", async () => {
    const res = await api("POST", "/clients/test-webhook", adminToken, {
      webhookUrl: "http://127.0.0.1:1/webhook",
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(typeof res.body.error).toBe("string");
  });
});
