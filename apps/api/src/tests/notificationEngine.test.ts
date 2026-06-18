import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { notifyClient, type ClientTarget } from "../services/notifications.js";

/**
 * Motor de notificaciones B2B (Tier 2): por evento del ciclo de vida el operador
 * decide si notifica al NEGOCIO cliente y con qué cuerpo. Desactivar un evento
 * suprime la notificación; el cuerpo se renderiza con placeholders. Mutación
 * solo ADMIN. Nunca se mensajea al consumidor final.
 */
const runId = Date.now();
const adminEmail = `notif+${runId}@test.moveos.co`;
const portalEmail = `notifcli+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;
let portalToken: string;
let orderId: string;
let client: ClientTarget;

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
  return { status: res.statusCode, body: res.body ? res.json() : undefined };
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const reg = await api("POST", "/auth/register", undefined, {
    tenantName: "Notif Co",
    adminName: "Admin",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = reg.body.tenant.id;
  adminToken = reg.body.token;

  const c = await api("POST", "/clients", adminToken, {
    name: "Comercio Notif",
    notifyChannel: "IN_APP",
  });
  await api("POST", `/clients/${c.body.id}/portal-access`, adminToken, {
    email: portalEmail,
    password: "moveos123",
  });
  portalToken = (
    await api("POST", "/auth/login", undefined, { email: portalEmail, password: "moveos123" })
  ).body.token;
  client = (await prisma.client.findUniqueOrThrow({
    where: { id: c.body.id },
    select: { id: true, name: true, email: true, phone: true, notifyChannel: true, webhookUrl: true },
  })) as ClientTarget;

  const order = await api("POST", "/orders", adminToken, {
    clientId: c.body.id,
    customerName: "Ana",
    customerPhone: "+573111111170",
    addressRaw: "Cra 13 # 54-20",
    lat: 4.64,
    lng: -74.06,
  });
  orderId = order.body.id;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("Motor de notificaciones B2B (Tier 2)", () => {
  it("GET /controls/notifications lista los 7 eventos con sus defaults", async () => {
    const res = await api("GET", "/controls/notifications", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(7);
    const delivered = res.body.find((r: { event: string }) => r.event === "DELIVERED");
    expect(delivered.enabled).toBe(true);
    expect(delivered.isDefault).toBe(true);
    expect(delivered.body).toContain("{{guia}}");
  });

  it("un evento desactivado NO genera notificación", async () => {
    const patch = await api("PATCH", "/controls/notifications", adminToken, {
      event: "DELIVERED",
      enabled: false,
      body: "Entregado {{guia}}",
    });
    expect(patch.status).toBe(200);
    expect(patch.body.enabled).toBe(false);

    await notifyClient({
      tenantId,
      orderId,
      client,
      template: "envio_entregado",
      event: "DELIVERED",
      payload: { trackingNumber: "MV-1", customerName: "Ana" },
    });
    const count = await prisma.notificationLog.count({ where: { orderId } });
    expect(count).toBe(0);
  });

  it("un evento activo renderiza el cuerpo con placeholders", async () => {
    await notifyClient({
      tenantId,
      orderId,
      client,
      template: "envio_en_reparto",
      event: "OUT_FOR_DELIVERY",
      payload: { trackingNumber: "MV-9", customerName: "Ana" },
    });
    const log = await prisma.notificationLog.findFirst({
      where: { orderId },
      orderBy: { createdAt: "desc" },
    });
    expect(log).not.toBeNull();
    expect((log!.payload as { message?: string }).message).toContain("MV-9");
    expect((log!.payload as { message?: string }).message).toContain("salió a reparto");
  });

  it("el rol CLIENT del portal no puede editar plantillas (403)", async () => {
    const res = await api("PATCH", "/controls/notifications", portalToken, {
      event: "FAILED",
      enabled: false,
      body: "x",
    });
    expect(res.status).toBe(403);
  });
});
