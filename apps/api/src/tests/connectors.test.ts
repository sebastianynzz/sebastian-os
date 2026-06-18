import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Conectores de ingesta (Tier 2 §8): un sistema externo (Shopify, VTEX, Mercado
 * Libre, Zapier) envía SU formato de pedido a /ingest/orders/:source con su API
 * key; el conector lo normaliza al formato de createOrder. Order-ingestion = el
 * desbloqueo de escala. Tenant-scoped por la key.
 */
const runId = Date.now();
const adminEmail = `conn+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;
let writeKey: string;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function api(
  method: "GET" | "POST",
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
    tenantName: "Connectors Co",
    adminName: "Admin",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = reg.body!.tenant.id;
  adminToken = reg.body!.token;
  writeKey = (
    await api("POST", "/developer/api-keys", adminToken, {
      name: "Tienda",
      scopes: ["orders:write"],
    })
  ).body.key;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("Conectores de ingesta (Tier 2 §8)", () => {
  it("Shopify: normaliza shipping_address + order_number", async () => {
    const res = await api("POST", "/ingest/orders/shopify", writeKey, {
      order_number: 1001,
      note: "Dejar en portería",
      shipping_address: {
        name: "Laura Martínez",
        address1: "Cra 13 # 54-20",
        city: "Bogotá",
        phone: "+573101000001",
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.source).toBe("shopify");
    const order = await prisma.order.findFirstOrThrow({
      where: { tenantId, externalRef: "1001" },
    });
    expect(order.customerName).toBe("Laura Martínez");
    expect(order.addressRaw).toContain("Cra 13 # 54-20");
  });

  it("VTEX: normaliza clientProfileData + shippingData.address", async () => {
    const res = await api("POST", "/ingest/orders/vtex", writeKey, {
      orderId: "VTEX-77",
      clientProfileData: {
        firstName: "Pedro",
        lastName: "Sánchez",
        phone: "+573102000002",
      },
      shippingData: {
        address: { street: "Cl 72", number: "10-34", city: "Bogotá" },
      },
    });
    expect(res.status).toBe(201);
    const order = await prisma.order.findFirstOrThrow({
      where: { tenantId, externalRef: "VTEX-77" },
    });
    expect(order.customerName).toBe("Pedro Sánchez");
  });

  it("Mercado Libre: normaliza buyer + shipping.receiver_address", async () => {
    const res = await api("POST", "/ingest/orders/mercadolibre", writeKey, {
      id: 200000123,
      buyer: { first_name: "Ana", last_name: "Gómez", phone: { number: "+573103000003" } },
      shipping: {
        receiver_address: { address_line: "Av 68 # 40-55", comment: "Apto 301" },
      },
    });
    expect(res.status).toBe(201);
    const order = await prisma.order.findFirstOrThrow({
      where: { tenantId, externalRef: "200000123" },
    });
    expect(order.customerName).toBe("Ana Gómez");
    expect(order.addressRaw).toContain("Av 68 # 40-55");
  });

  it("Zapier / genérico: passthrough acotado", async () => {
    const res = await api("POST", "/ingest/orders/zapier", writeKey, {
      name: "Carlos Ruiz",
      phone: "+573104000004",
      address: "Cra 7 # 71-21",
      reference: "ZAP-9",
    });
    expect(res.status).toBe(201);
    const order = await prisma.order.findFirstOrThrow({
      where: { tenantId, externalRef: "ZAP-9" },
    });
    expect(order.customerName).toBe("Carlos Ruiz");
  });

  it("rechaza una fuente desconocida (400) y un payload incompleto (400)", async () => {
    expect(
      (await api("POST", "/ingest/orders/desconocido", writeKey, {})).status,
    ).toBe(400);
    // Shopify sin dirección → createOrderSchema falla.
    expect(
      (
        await api("POST", "/ingest/orders/shopify", writeKey, {
          shipping_address: { name: "Solo Nombre" },
        })
      ).status,
    ).toBe(400);
  });

  it("exige el scope orders:write (la fuente no evita la autenticación)", async () => {
    expect(
      (await api("POST", "/ingest/orders/shopify", undefined, {})).status,
    ).toBe(401);
  });

  it("idempotente: reenviar el mismo pedido no lo duplica (reintentos de webhook)", async () => {
    const payload = {
      order_number: 5005,
      shipping_address: {
        name: "Idem Test",
        address1: "Cl 100 # 11-22",
        city: "Bogotá",
        phone: "+573109999999",
      },
    };
    const first = await api("POST", "/ingest/orders/shopify", writeKey, payload);
    const second = await api("POST", "/ingest/orders/shopify", writeKey, payload);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    // El segundo POST devuelve el MISMO pedido (no crea otro): Shopify/VTEX/MELI
    // reintentan sus webhooks; el externalRef del conector deduplica.
    expect(second.body.id).toBe(first.body.id);
    const count = await prisma.order.count({
      where: { tenantId, externalRef: "5005" },
    });
    expect(count).toBe(1);
  });
});
