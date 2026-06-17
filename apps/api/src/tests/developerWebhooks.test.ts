import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { signWebhook } from "../services/webhooks.js";

/**
 * Plataforma de desarrolladores (Tier 2 §8): webhooks del tenant suscritos a
 * eventos. CRUD (mutación solo ADMIN), entrega de prueba firmada (HMAC-SHA256,
 * cabecera x-moveos-signature) y aislamiento por tenant.
 */
const runId = Date.now();
const adminEmail = `dev+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;

let hookServer: Server;
let hookUrl: string;
const received: { event: string; signature: string; raw: string }[] = [];

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
  return { status: res.statusCode, body: res.body ? res.json() : undefined };
}

beforeAll(async () => {
  hookServer = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      received.push({
        event: String(req.headers["x-moveos-event"] ?? ""),
        signature: String(req.headers["x-moveos-signature"] ?? ""),
        raw: data,
      });
      res.writeHead(200).end("ok");
    });
  });
  await new Promise<void>((r) => hookServer.listen(0, r));
  hookUrl = `http://127.0.0.1:${(hookServer.address() as { port: number }).port}/hook`;

  app = await buildApp();
  await app.ready();
  const reg = await api("POST", "/auth/register", undefined, {
    tenantName: "Dev Co",
    adminName: "Admin",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = reg.body.tenant.id;
  adminToken = reg.body.token;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await app.close();
  await new Promise<void>((r) => hookServer.close(() => r()));
  await prisma.$disconnect();
});

describe("Webhooks de desarrollador (Tier 2 §8)", () => {
  let webhookId: string;
  let secret: string;

  it("crea un webhook con secreto generado por el servidor", async () => {
    const res = await api("POST", "/developer/webhooks", adminToken, {
      url: hookUrl,
      events: ["DELIVERED", "FAILED"],
    });
    expect(res.status).toBe(201);
    expect(res.body.secret).toMatch(/^whsec_/);
    expect(res.body.events).toEqual(["DELIVERED", "FAILED"]);
    webhookId = res.body.id;
    secret = res.body.secret;
  });

  it("rechaza una lista de eventos vacía (400)", async () => {
    const res = await api("POST", "/developer/webhooks", adminToken, {
      url: hookUrl,
      events: [],
    });
    expect(res.status).toBe(400);
  });

  it("la entrega de prueba llega firmada (HMAC) con el evento", async () => {
    const before = received.length;
    const res = await api("POST", `/developer/webhooks/${webhookId}/test`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(received.length).toBe(before + 1);
    const last = received[received.length - 1]!;
    expect(last.event).toBe("DELIVERED");
    // La firma debe corresponder al HMAC-SHA256 del cuerpo con el secreto.
    expect(last.signature).toBe(signWebhook(secret, last.raw));
    expect(JSON.parse(last.raw).data.test).toBe(true);
  });

  it("desactivar el webhook lo excluye de la entrega por evento", async () => {
    const patch = await api("PATCH", `/developer/webhooks/${webhookId}`, adminToken, {
      enabled: false,
    });
    expect(patch.status).toBe(200);
    expect(patch.body.enabled).toBe(false);
  });

  it("elimina el webhook (204) y responde 404 a uno inexistente", async () => {
    expect((await api("DELETE", `/developer/webhooks/${webhookId}`, adminToken)).status).toBe(204);
    expect((await api("DELETE", "/developer/webhooks/nope", adminToken)).status).toBe(404);
  });
});
