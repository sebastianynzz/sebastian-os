import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Import CSV resiliente por fila: una fila inválida NO debe tumbar el lote.
 * /orders/bulk valida y crea fila por fila y devuelve el detalle por fila para
 * que el despachador vea cuáles fallaron — las buenas entran igual.
 */

const runId = Date.now();
const adminEmail = `bulk+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;

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
    tenantName: "Bulk Import Co",
    adminName: "Admin Bulk",
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

describe("POST /orders/bulk — resiliente por fila", () => {
  it("importa las filas válidas y reporta las inválidas sin tumbar el lote", async () => {
    const res = await api("POST", "/orders/bulk", adminToken, [
      {
        customerName: "Cliente Bueno",
        customerPhone: "+573101000001",
        addressRaw: "Cra 13 # 54-20",
        lat: 4.6416,
        lng: -74.0639,
      },
      // Fila 2 inválida: teléfono y dirección demasiado cortos.
      { customerName: "X", customerPhone: "12", addressRaw: "a" },
      {
        customerName: "Cliente Bueno 2",
        customerPhone: "+573101000002",
        addressRaw: "Cl 72 # 10-34",
        lat: 4.66,
        lng: -74.05,
      },
    ]);

    expect(res.status).toBe(201);
    expect(res.body.created).toBe(2);
    expect(res.body.failed).toBe(1);
    expect(res.body.results).toHaveLength(3);

    const bad = res.body.results.find((r: { ok: boolean }) => !r.ok);
    expect(bad.row).toBe(2);
    expect(typeof bad.error).toBe("string");
    expect(bad.error.length).toBeGreaterThan(0);

    // Las dos filas buenas quedaron realmente creadas en el tenant.
    const orders = await api("GET", "/orders", adminToken);
    expect(orders.body.length).toBe(2);
  });

  it("rechaza un lote vacío", async () => {
    const res = await api("POST", "/orders/bulk", adminToken, []);
    expect(res.status).toBe(400);
  });
});
