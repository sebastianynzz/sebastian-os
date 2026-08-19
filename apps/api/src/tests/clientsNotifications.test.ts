import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Feed de avisos B2B por cliente: paginación por ventana (skip/take). El feed
 * puede crecer sin límite, así que el panel lo carga de a páginas ("Ver más").
 */

const runId = Date.now();
const adminEmail = `cli-admin+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;
let clientId = "";

async function api(
  method: "GET" | "POST",
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

  const reg = await api("POST", "/auth/register", undefined, {
    tenantName: "Test Clientes Feed",
    adminName: "Admin Feed",
    city: "Bogotá",
    email: adminEmail,
    password: "dalego123",
  });
  tenantId = reg.body.tenant.id;
  adminToken = reg.body.token;

  const client = await api("POST", "/clients", adminToken, {
    name: "Negocio Feed",
    notifyChannel: "IN_APP",
  });
  expect(client.status).toBe(201);
  clientId = client.body.id;

  // Sembrar 25 avisos para forzar más de una página (FEED_PAGE = 20).
  await prisma.notificationLog.createMany({
    data: Array.from({ length: 25 }, (_, i) => ({
      tenantId,
      clientId,
      channel: "CONSOLE",
      recipient: "feed",
      template: i % 2 === 0 ? "envio_entregado" : "envio_en_reparto",
      payload: {},
      status: "SENT",
    })),
  });
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("feed de avisos por cliente — paginación", () => {
  it("la primera página devuelve take elementos", async () => {
    const res = await api("GET", `/clients/${clientId}/notifications?skip=0&take=20`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(20);
  });

  it("la segunda página devuelve el resto (ventana skip/take)", async () => {
    const res = await api("GET", `/clients/${clientId}/notifications?skip=20&take=20`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5);
  });

  it("sin parámetros aplica un tope por defecto (no devuelve todo de golpe)", async () => {
    const res = await api("GET", `/clients/${clientId}/notifications`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(20);
  });
});

describe("prueba del canal de avisos del cliente (Phase E)", () => {
  it("envía un aviso de prueba por el canal configurado (IN_APP → CONSOLE)", async () => {
    const res = await api("POST", `/clients/${clientId}/test-notification`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.channel).toBe("CONSOLE");
  });

  it("404 si el cliente no existe en el tenant", async () => {
    const res = await api("POST", "/clients/noexiste/test-notification", adminToken);
    expect(res.status).toBe(404);
  });
});
