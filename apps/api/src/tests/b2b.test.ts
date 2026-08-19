import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Modelo B2B: cuando un envío se entrega, la confirmación se notifica al
 * NEGOCIO CLIENTE (no al consumidor final). Verifica el ciclo con un cliente
 * de canal WEBHOOK: al entregar, su endpoint recibe el evento.
 */

const runId = Date.now();
const adminEmail = `b2b-admin+${runId}@test.moveos.co`;
const driverEmail = `b2b-driver+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;
let driverToken: string;
let driverId: string;
let clientId: string;

// Servidor que captura los webhooks entrantes del negocio cliente.
let hookServer: Server;
let hookPort: number;
const received: unknown[] = [];

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
  hookServer = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        received.push(JSON.parse(data));
      } catch {
        received.push(data);
      }
      res.writeHead(200).end("ok");
    });
  });
  await new Promise<void>((r) => hookServer.listen(0, r));
  hookPort = (hookServer.address() as { port: number }).port;

  app = await buildApp();
  await app.ready();

  const reg = await api("POST", "/auth/register", undefined, {
    tenantName: "Test B2B",
    adminName: "Admin B2B",
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
  await new Promise<void>((r) => hookServer.close(() => r()));
});

describe("notificaciones B2B (al negocio cliente)", () => {
  it("crea un negocio cliente con canal WEBHOOK", async () => {
    const res = await api("POST", "/clients", adminToken, {
      name: "Distribuidora Test",
      contactName: "Ops",
      notifyChannel: "WEBHOOK",
      webhookUrl: `http://127.0.0.1:${hookPort}/hook`,
    });
    expect(res.status).toBe(201);
    clientId = res.body.id;
  });

  it("rechaza canal WEBHOOK sin URL", async () => {
    const res = await api("POST", "/clients", adminToken, {
      name: "Sin URL",
      notifyChannel: "WEBHOOK",
    });
    expect(res.status).toBe(400);
  });

  it("entrega un envío y notifica al NEGOCIO por webhook (no al consumidor)", async () => {
    // Conductor + vehículo + pedido del negocio cliente.
    const driver = await api("POST", "/drivers", adminToken, {
      name: "Conductor B2B",
      phone: "+573000000009",
      documentId: "900900900",
      email: driverEmail,
      password: "dalego123",
    });
    driverId = driver.body.id;
    await api("POST", "/vehicles", adminToken, {
      plate: "B2B11A",
      type: "RAP_MOVE_LIGHT",
      capacityKg: 20,
    });

    const order = await api("POST", "/orders", adminToken, {
      clientId,
      customerName: "Consumidor Final",
      customerPhone: "+573111111199",
      addressRaw: "Cra 13 # 54-20",
      lat: 4.6416,
      lng: -74.0639,
    });
    expect(order.status).toBe(201);
    expect(order.body.clientId).toBe(clientId);

    // Planificar → despachar → iniciar → entregar.
    const vehicles = await api("GET", "/vehicles", adminToken);
    const plan = await api("POST", "/optimization/plans", adminToken, {
      date: "2026-06-14",
      depot: { lat: 4.6486, lng: -74.0628 },
      orderIds: [order.body.id],
      vehicleIds: vehicles.body.map((v: { id: string }) => v.id),
    });
    const routeId = plan.body.routes[0].id;
    await api("POST", `/routes/${routeId}/dispatch`, adminToken, { driverId });

    const login = await api("POST", "/auth/login", undefined, {
      email: driverEmail,
      password: "dalego123",
    });
    driverToken = login.body.token;
    await api("POST", `/routes/${routeId}/start`, driverToken);

    const route = await api("GET", `/routes/${routeId}`, adminToken);
    const stopId = route.body.stops[0].id;
    const complete = await api("POST", `/routes/stops/${stopId}/complete`, driverToken, {
      types: ["GEOFENCE"],
      receivedBy: "Portería",
      lat: 4.6416,
      lng: -74.0639,
    });
    expect(complete.status).toBe(200);

    // Dar tiempo a que el webhook llegue.
    await new Promise((r) => setTimeout(r, 200));

    // El webhook del NEGOCIO recibió la confirmación de entrega.
    const delivered = received.find(
      (m): m is { event: string; standardEvent: string; data: { destinatario: string } } =>
        typeof m === "object" && m !== null && (m as { event?: string }).event === "envio_entregado",
    );
    expect(delivered).toBeDefined();
    expect(delivered!.data.destinatario).toBe("Consumidor Final");
    // Campo estandarizado (no rompe `event`): catálogo NOTIFICATION_EVENTS.
    expect(delivered!.standardEvent).toBe("DELIVERED");

    // Quedó registrado en el feed de notificaciones del cliente.
    const feed = await api("GET", `/clients/${clientId}/notifications`, adminToken);
    expect(feed.body.some((n: { template: string }) => n.template === "envio_entregado")).toBe(true);
    expect(feed.body[0].channel).toBe("WEBHOOK");
  });
});
