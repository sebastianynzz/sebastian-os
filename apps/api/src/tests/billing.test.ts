import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Facturación de la suscripción SaaS (Tier 3 §13): el tenant mantiene sus datos
 * fiscales y ve su historial de facturas; la plataforma las emite. MoveOS no
 * procesa pagos en la app (sin COD). Tenant-scoped; perfil editable por ADMIN.
 */
const runId = Date.now();
const adminEmail = `bill+${runId}@test.moveos.co`;
const opsEmail = `billops+${runId}@moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;
let platformToken: string;

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

  await prisma.platformAdmin.create({
    data: {
      email: opsEmail,
      name: "Ops Bill",
      passwordHash: await bcrypt.hash("dalego123", 10),
    },
  });

  const reg = await api("POST", "/auth/register", undefined, {
    tenantName: "Billing Co",
    adminName: "Admin",
    city: "Bogotá",
    email: adminEmail,
    password: "dalego123",
  });
  tenantId = reg.body!.tenant.id;
  adminToken = reg.body!.token;

  platformToken = (
    await api("POST", "/platform/auth/login", undefined, {
      email: opsEmail,
      password: "dalego123",
    })
  ).body.token;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.platformAdmin.deleteMany({ where: { email: opsEmail } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("Facturación de la suscripción SaaS (Tier 3 §13)", () => {
  it("el tenant edita su perfil fiscal (solo ADMIN)", async () => {
    const res = await api("PATCH", "/controls/billing", adminToken, {
      legalName: "Billing Co SAS",
      nit: "900123456-7",
      billingEmail: "facturas@billingco.co",
      billingAddress: "Cra 7 # 71-21, Bogotá",
    });
    expect(res.status).toBe(200);
    expect(res.body.legalName).toBe("Billing Co SAS");
    expect(res.body.nit).toBe("900123456-7");

    const get = await api("GET", "/controls/billing", adminToken);
    expect(get.body.profile.billingEmail).toBe("facturas@billingco.co");
    expect(get.body.invoices).toEqual([]);
  });

  it("la plataforma emite una factura y el tenant la ve en su historial", async () => {
    const issued = await api(
      "POST",
      `/platform/tenants/${tenantId}/invoices`,
      platformToken,
      {
        number: "FAC-001",
        periodMonth: "2026-06",
        amountCop: 250000,
        status: "ISSUED",
      },
    );
    expect(issued.status).toBe(201);

    const billing = await api("GET", "/controls/billing", adminToken);
    expect(billing.body.invoices).toHaveLength(1);
    expect(billing.body.invoices[0]).toMatchObject({
      number: "FAC-001",
      amountCop: 250000,
      status: "ISSUED",
    });
  });

  it("rechaza un número de factura duplicado en el mismo tenant (409)", async () => {
    const dup = await api(
      "POST",
      `/platform/tenants/${tenantId}/invoices`,
      platformToken,
      { number: "FAC-001", periodMonth: "2026-07", amountCop: 250000 },
    );
    expect(dup.status).toBe(409);
  });

  it("la emisión de facturas exige operador de plataforma (no el token del tenant)", async () => {
    const res = await api(
      "POST",
      `/platform/tenants/${tenantId}/invoices`,
      adminToken,
      { number: "FAC-002", periodMonth: "2026-07", amountCop: 100000 },
    );
    // El token del tenant es un JWT válido pero no es de plataforma → 403.
    expect(res.status).toBe(403);
  });
});
