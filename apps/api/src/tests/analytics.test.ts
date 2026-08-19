import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { addDays, todayBogota } from "../services/dailyMetrics.js";

/**
 * Serie diaria de Analítica Pro (rollup DailyTenantMetric): atribución por
 * día de Bogotá, relleno con ceros, idempotencia del recompute perezoso,
 * gating por módulo y aislamiento entre tenants.
 */

const runId = Date.now();
const adminEmail = `ts-admin+${runId}@test.moveos.co`;
const otherAdminEmail = `ts-other+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;
let otherTenantId: string;
let otherToken: string;

// Tres días de Bogotá: anteayer, ayer y hoy.
const today = todayBogota();
const day1 = addDays(today, -2);
const day2 = addDays(today, -1);

/** Mediodía de Bogotá (UTC-5) de un día dado: cae sin ambigüedad en ese día. */
const noonBogota = (day: string) => new Date(`${day}T12:00:00-05:00`);

async function api(
  method: "GET" | "POST" | "PATCH",
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
    tenantName: "Test Timeseries",
    adminName: "Admin TS",
    city: "Bogotá",
    email: adminEmail,
    password: "dalego123",
  });
  tenantId = reg.body.tenant.id;
  adminToken = reg.body.token;

  const reg2 = await api("POST", "/auth/register", undefined, {
    tenantName: "Test Timeseries Ajeno",
    adminName: "Admin Ajeno",
    city: "Bogotá",
    email: otherAdminEmail,
    password: "dalego123",
  });
  otherTenantId = reg2.body.tenant.id;
  otherToken = reg2.body.token;

  // Pedidos con fechas controladas (directo a la base): 2 creados anteayer
  // (uno entregado ayer) y 1 creado ayer.
  await prisma.order.createMany({
    data: [
      {
        tenantId,
        customerName: "Cliente Uno",
        customerPhone: "+573100000001",
        addressRaw: "Cl 1 # 1-01",
        status: "GEOCODED",
        createdAt: noonBogota(day1),
      },
      {
        tenantId,
        customerName: "Cliente Dos",
        customerPhone: "+573100000002",
        addressRaw: "Cl 2 # 2-02",
        status: "DELIVERED",
        createdAt: noonBogota(day1),
        deliveredAt: noonBogota(day2),
      },
      {
        tenantId,
        customerName: "Cliente Tres",
        customerPhone: "+573100000003",
        addressRaw: "Cl 3 # 3-03",
        status: "GEOCODED",
        createdAt: noonBogota(day2),
      },
    ],
  });
});

afterAll(async () => {
  for (const id of [tenantId, otherTenantId]) {
    if (id) await prisma.tenant.delete({ where: { id } }).catch(() => {});
  }
  await app.close();
  await prisma.$disconnect();
});

describe("serie diaria de analítica", () => {
  it("sin el módulo ANALYTICS_PRO responde 403 MODULE_NOT_ENABLED", async () => {
    const res = await api("GET", "/analytics/timeseries", adminToken);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("MODULE_NOT_ENABLED");
  });

  it("atribuye pedidos al día de Bogotá correcto y rellena huecos con ceros", async () => {
    await api("PATCH", "/modules/ANALYTICS_PRO", adminToken, { enabled: true });

    const res = await api(
      "GET",
      `/analytics/timeseries?from=${day1}&to=${today}`,
      adminToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(3);

    const byDate = new Map(
      res.body.days.map((d: { date: string }) => [d.date, d]),
    );
    const d1 = byDate.get(day1) as { ordersCreated: number; ordersDelivered: number };
    const d2 = byDate.get(day2) as {
      ordersCreated: number;
      ordersDelivered: number;
      successRate: number | null;
    };
    const dToday = byDate.get(today) as { ordersCreated: number };
    expect(d1.ordersCreated).toBe(2);
    expect(d1.ordersDelivered).toBe(0);
    expect(d2.ordersCreated).toBe(1);
    expect(d2.ordersDelivered).toBe(1);
    expect(d2.successRate).toBe(1); // 1 entregado, 0 fallidos
    expect(dToday.ordersCreated).toBe(0); // día sin actividad: cero, no hueco
  });

  it("es idempotente: dos lecturas devuelven exactamente la misma serie", async () => {
    const first = await api(
      "GET",
      `/analytics/timeseries?from=${day1}&to=${today}`,
      adminToken,
    );
    const second = await api(
      "GET",
      `/analytics/timeseries?from=${day1}&to=${today}`,
      adminToken,
    );
    expect(second.body.days).toEqual(first.body.days);

    // Y en la base hay UNA fila por día (upsert, no duplicados).
    const rows = await prisma.dailyTenantMetric.findMany({
      where: { tenantId, date: { gte: day1, lte: today } },
    });
    expect(rows).toHaveLength(3);
  });

  it("aísla tenants: otro tenant ve su propia serie en ceros", async () => {
    await api("PATCH", "/modules/ANALYTICS_PRO", otherToken, { enabled: true });
    const res = await api(
      "GET",
      `/analytics/timeseries?from=${day1}&to=${today}`,
      otherToken,
    );
    expect(res.status).toBe(200);
    const total = res.body.days.reduce(
      (acc: number, d: { ordersCreated: number }) => acc + d.ordersCreated,
      0,
    );
    expect(total).toBe(0);
  });

  it("valida el rango: from > to responde 400", async () => {
    const res = await api(
      "GET",
      `/analytics/timeseries?from=${today}&to=${day1}`,
      adminToken,
    );
    expect(res.status).toBe(400);
  });
});
