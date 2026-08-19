import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import {
  emitTenant,
  subscribeTenant,
  type StreamSubscriber,
} from "../services/realtime.js";

/**
 * Portal de clientes (rol CLIENT): el negocio B2B entra con su propio usuario,
 * crea envíos con recogida en su dirección registrada y solo ve SUS pedidos.
 * Verifica el aislamiento: ni el plano operativo del tenant ni los pedidos de
 * otros negocios le son visibles.
 */

const runId = Date.now();
const adminEmail = `portal-admin+${runId}@test.moveos.co`;
const portalEmail = `portal-cliente+${runId}@test.moveos.co`;
const driverEmail = `portal-driver+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;
let portalToken: string;
let clientAId: string;
let clientBId: string;
let portalOrderId: string;

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
    tenantName: "Test Portal",
    adminName: "Admin Portal",
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

describe("portal de clientes (rol CLIENT)", () => {
  it("crea dos negocios cliente, uno con dirección de recogida registrada", async () => {
    const a = await api("POST", "/clients", adminToken, {
      name: "Moda Test",
      contactName: "Carolina",
      notifyChannel: "IN_APP",
      pickupAddressRaw: "Cra 9 # 60-15, Chapinero",
      pickupLat: 4.6463,
      pickupLng: -74.0628,
      pickupNotes: "Local 2",
    });
    expect(a.status).toBe(201);
    expect(a.body.pickupAddressRaw).toBe("Cra 9 # 60-15, Chapinero");
    clientAId = a.body.id;

    const b = await api("POST", "/clients", adminToken, {
      name: "Otro Negocio",
      notifyChannel: "IN_APP",
    });
    clientBId = b.body.id;
  });

  it("el ADMIN entrega acceso al portal (y solo el ADMIN)", async () => {
    const res = await api("POST", `/clients/${clientAId}/portal-access`, adminToken, {
      email: portalEmail,
      password: "dalego123",
    });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe("CLIENT");
    expect(res.body.clientId).toBe(clientAId);

    // Correo duplicado → 409.
    const dup = await api("POST", `/clients/${clientAId}/portal-access`, adminToken, {
      email: portalEmail,
      password: "dalego123",
    });
    expect(dup.status).toBe(409);

    // Un conductor no puede entregar credenciales del portal.
    await api("POST", "/drivers", adminToken, {
      name: "Conductor Portal",
      phone: "+573000000077",
      documentId: "900900901",
      email: driverEmail,
      password: "dalego123",
    });
    const driverLogin = await api("POST", "/auth/login", undefined, {
      email: driverEmail,
      password: "dalego123",
    });
    const denied = await api(
      "POST",
      `/clients/${clientBId}/portal-access`,
      driverLogin.body.token,
      { email: `otro+${runId}@test.moveos.co`, password: "dalego123" },
    );
    expect(denied.status).toBe(403);
  });

  it("el usuario del portal inicia sesión y /auth/me responde", async () => {
    const login = await api("POST", "/auth/login", undefined, {
      email: portalEmail,
      password: "dalego123",
    });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe("CLIENT");
    expect(login.body.user.clientId).toBe(clientAId);
    portalToken = login.body.token;

    const me = await api("GET", "/auth/me", portalToken);
    expect(me.status).toBe(200);
    expect(me.body.user.clientId).toBe(clientAId);
  });

  it("el plano operativo del tenant está cerrado para el rol CLIENT", async () => {
    for (const url of ["/orders", "/clients", "/drivers", "/vehicles", "/routes"]) {
      const res = await api("GET", url, portalToken);
      expect(res.status, url).toBe(403);
      expect(res.body.code, url).toBe("CLIENT_PORTAL_ONLY");
    }
  });

  it("crea un envío desde el portal con recogida en su dirección registrada", async () => {
    const res = await api("POST", "/portal/orders", portalToken, {
      customerName: "Consumidor Portal",
      customerPhone: "+573111111188",
      addressRaw: "Cl 72 # 10-34, Quinta Camacho",
      pickupMode: "REGISTERED",
      weightKg: 2,
    });
    expect(res.status).toBe(201);
    expect(res.body.pickupAddressRaw).toBe("Cra 9 # 60-15, Chapinero");
    expect(res.body.status).toBe("GEOCODED");
    expect(res.body.trackingUrl).toContain("/t/");
    portalOrderId = res.body.id;

    // La recogida registrada usó las coordenadas guardadas del negocio.
    const order = await prisma.order.findUniqueOrThrow({ where: { id: portalOrderId } });
    expect(order.clientId).toBe(clientAId);
    expect(order.pickupLat).toBeCloseTo(4.6463, 3);
  });

  it("rechaza recogida registrada si el negocio no tiene dirección", async () => {
    // Acceso del negocio B (sin dirección de recogida registrada).
    const accessB = await api("POST", `/clients/${clientBId}/portal-access`, adminToken, {
      email: `portal-b+${runId}@test.moveos.co`,
      password: "dalego123",
    });
    expect(accessB.status).toBe(201);
    const loginB = await api("POST", "/auth/login", undefined, {
      email: `portal-b+${runId}@test.moveos.co`,
      password: "dalego123",
    });
    const res = await api("POST", "/portal/orders", loginB.body.token, {
      customerName: "Consumidor B",
      customerPhone: "+573111111177",
      addressRaw: "Cl 100 # 19-61",
      pickupMode: "REGISTERED",
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("NO_PICKUP_ADDRESS");

    // Pero sí puede pedir recogida puntual o flujo desde depósito.
    const custom = await api("POST", "/portal/orders", loginB.body.token, {
      customerName: "Consumidor B",
      customerPhone: "+573111111177",
      addressRaw: "Cl 100 # 19-61",
      pickupMode: "NONE",
    });
    expect(custom.status).toBe(201);
  });

  it("solo ve los pedidos de SU negocio", async () => {
    // Pedido del negocio B creado por el personal del tenant.
    const ofB = await api("POST", "/orders", adminToken, {
      clientId: clientBId,
      customerName: "Cliente De B",
      customerPhone: "+573111111166",
      addressRaw: "Cra 7 # 32-16",
      lat: 4.6206,
      lng: -74.0689,
    });
    expect(ofB.status).toBe(201);

    const list = await api("GET", "/portal/orders", portalToken);
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(1);
    expect(list.body[0].id).toBe(portalOrderId);

    // El detalle de un pedido ajeno responde 404 (ni siquiera existe para él).
    const foreign = await api("GET", `/portal/orders/${ofB.body.id}`, portalToken);
    expect(foreign.status).toBe(404);

    const own = await api("GET", `/portal/orders/${portalOrderId}`, portalToken);
    expect(own.status).toBe(200);
    expect(own.body.events.some((e: { type: string }) => e.type === "CREATED")).toBe(true);
  });

  it("resumen e informe verde del portal responden", async () => {
    const summary = await api("GET", "/portal/summary", portalToken);
    expect(summary.status).toBe(200);
    expect(summary.body.createdThisMonth).toBeGreaterThanOrEqual(1);
    // Tablero del portal: tasa de éxito, en curso y tendencia de 30 días.
    expect(summary.body).toHaveProperty("successRate");
    expect(summary.body.inTransit).toBe(0);
    expect(summary.body.byDay).toHaveLength(30);
    const totalCreated = summary.body.byDay.reduce(
      (acc: number, d: { created: number }) => acc + d.created,
      0,
    );
    expect(totalCreated).toBeGreaterThanOrEqual(1); // su pedido aparece en la serie

    const green = await api("GET", "/portal/green-report", portalToken);
    expect(green.status).toBe(200);
    expect(green.body.deliveredOrders).toBe(0); // sin rutas todavía
    expect(green.body.co2Kg).toBe(0);
  });

  it("el personal del tenant NO puede usar el portal", async () => {
    const res = await api("GET", "/portal/orders", adminToken);
    expect(res.status).toBe(403);
  });
});

describe("streams SSE", () => {
  it("rechaza el stream sin token o con token inválido", async () => {
    const noToken = await app.inject({ method: "GET", url: "/realtime/stream" });
    expect(noToken.statusCode).toBe(400);

    const badToken = await app.inject({
      method: "GET",
      url: "/realtime/stream?token=invalido-invalido",
    });
    expect(badToken.statusCode).toBe(401);

    // Un token de tenant no abre el stream de plataforma.
    const wrongPlane = await app.inject({
      method: "GET",
      url: `/realtime/platform/stream?token=${adminToken}`,
    });
    expect(wrongPlane.statusCode).toBe(403);
  });

  it("el rastreo público con token inexistente responde 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/track/token-inexistente-123/stream",
    });
    expect(res.statusCode).toBe(404);
  });

  it("el bus filtra: el portal solo recibe pedidos de SU negocio", () => {
    const received: Array<{ event: string; data: unknown }> = [];
    const staff: StreamSubscriber = {
      send: (event, data) => received.push({ event, data }),
      close: () => {},
    };
    const portal: StreamSubscriber = {
      clientId: "negocio-a",
      send: (event, data) => received.push({ event: `portal:${event}`, data }),
      close: () => {},
    };
    const unsubStaff = subscribeTenant("tenant-x", staff);
    const unsubPortal = subscribeTenant("tenant-x", portal);

    emitTenant("tenant-x", "telemetry", { lat: 1, lng: 2 });
    emitTenant("tenant-x", "order", { orderId: "o1", clientId: "negocio-a", status: "DELIVERED" });
    emitTenant("tenant-x", "order", { orderId: "o2", clientId: "negocio-b", status: "DELIVERED" });
    emitTenant("otro-tenant", "order", { orderId: "o3", clientId: "negocio-a", status: "DELIVERED" });

    unsubStaff();
    unsubPortal();

    // El personal recibe todo lo de su tenant (3 eventos), nada de otros tenants.
    expect(received.filter((r) => !r.event.startsWith("portal:")).length).toBe(3);
    // El portal solo el pedido de su negocio.
    const portalEvents = received.filter((r) => r.event.startsWith("portal:"));
    expect(portalEvents.length).toBe(1);
    expect((portalEvents[0]!.data as { orderId: string }).orderId).toBe("o1");
  });
});
