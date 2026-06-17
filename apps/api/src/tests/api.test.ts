import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Prueba de integración end-to-end del flujo completo:
 * registro → pedidos → plan de rutas → despacho → entrega con POD →
 * toggles de módulos.
 *
 * Requiere DATABASE_URL apuntando a un Postgres con el esquema aplicado
 * (pnpm db:push).
 */

const runId = Date.now();
const adminEmail = `admin+${runId}@test.moveos.co`;
const driverEmail = `driver+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;
let driverToken: string;
let driverId: string;

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
});

afterAll(async () => {
  if (tenantId) {
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  }
  await app.close();
  await prisma.$disconnect();
});

describe("flujo completo MoveOS", () => {
  it("registra un tenant con módulos por defecto", async () => {
    const res = await api("POST", "/auth/register", undefined, {
      tenantName: "Test Logística",
      adminName: "Admin Test",
      city: "Bogotá",
      email: adminEmail,
      password: "moveos123",
    });
    expect(res.status).toBe(201);
    tenantId = res.body.tenant.id;
    adminToken = res.body.token;
  });

  it("activa módulos adicionales para el tenant (seguridad, analítica)", async () => {
    // EV es NÚCLEO (plataforma EV-only): disponible sin activar nada.
    const ev = await api("GET", "/ev/overview", adminToken);
    expect(ev.status).toBe(200);

    // Los módulos premium nacen apagados: el admin los activa según contrato.
    const safety = await api("GET", "/safety/alerts", adminToken);
    expect(safety.status).toBe(403);
    expect(safety.body.code).toBe("MODULE_NOT_ENABLED");

    for (const key of ["SAFETY", "ANALYTICS_PRO"]) {
      const res = await api("PATCH", `/modules/${key}`, adminToken, {
        enabled: true,
      });
      expect(res.status).toBe(200);
    }
  });

  it("rechaza peticiones sin token", async () => {
    const res = await api("GET", "/orders");
    expect(res.status).toBe(401);
  });

  it("crea vehículos, conductor con cuenta y pedidos (geocodificando los que no traen coordenadas)", async () => {
    const moto = await api("POST", "/vehicles", adminToken, {
      plate: "TST12A",
      type: "RAP_MOVE_LIGHT",
      capacityKg: 20,
    });
    expect(moto.status).toBe(201);

    const ev = await api("POST", "/vehicles", adminToken, {
      plate: "TEV34B",
      type: "IONAX",
      capacityKg: 600,
      isElectric: true,
      batteryKwh: 42,
      nominalRangeKm: 200,
    });
    expect(ev.status).toBe(201);

    const driver = await api("POST", "/drivers", adminToken, {
      name: "Conductor Test",
      phone: "+573000000001",
      documentId: "100200300",
      email: driverEmail,
      password: "moveos123",
    });
    expect(driver.status).toBe(201);
    driverId = driver.body.id;

    const withCoords = await api("POST", "/orders", adminToken, {
      customerName: "Cliente Uno",
      customerPhone: "+573111111111",
      addressRaw: "Cra 13 # 54-20",
      lat: 4.6416,
      lng: -74.0639,
    });
    expect(withCoords.status).toBe(201);
    expect(withCoords.body.status).toBe("GEOCODED");
    expect(withCoords.body.trackingNumber).toMatch(/^MV-[A-Z2-9]{8}$/);

    // Dirección informal sin coordenadas: debe geocodificar (mock en dev).
    const informal = await api("POST", "/orders", adminToken, {
      customerName: "Cliente Dos",
      customerPhone: "+573122222222",
      addressRaw: "Frente al colegio San José, barrio La Paz",
    });
    expect(informal.status).toBe(201);
    expect(informal.body.lat).toBeTypeOf("number");
    expect(informal.body.geocodeSource).toBe("MOCK");
  });

  let routeId: string;
  let firstStopId: string;
  let firstStopOrderId: string;

  it("planifica rutas con el optimizador (domingo: sin pico y placa)", async () => {
    const orders = await api("GET", "/orders", adminToken);
    const orderIds = orders.body
      .filter((o: { status: string }) => o.status === "GEOCODED")
      .map((o: { id: string }) => o.id);
    const vehicles = await api("GET", "/vehicles", adminToken);
    const vehicleIds = vehicles.body.map((v: { id: string }) => v.id);

    const plan = await api("POST", "/optimization/plans", adminToken, {
      date: "2026-06-14",
      depot: { lat: 4.6486, lng: -74.0628 },
      orderIds,
      vehicleIds,
    });
    expect(plan.status).toBe(201);
    expect(plan.body.routes.length).toBeGreaterThan(0);

    routeId = plan.body.routes[0].id;
    const route = await api("GET", `/routes/${routeId}`, adminToken);
    expect(route.status).toBe(200);
    expect(route.body.stops.length).toBeGreaterThan(0);
    firstStopId = route.body.stops[0].id;
    firstStopOrderId = route.body.stops[0].orderId;
  });

  it("despacha la ruta a un conductor y este la inicia", async () => {
    const dispatch = await api("POST", `/routes/${routeId}/dispatch`, adminToken, {
      driverId,
    });
    expect(dispatch.status).toBe(200);
    expect(dispatch.body.status).toBe("DISPATCHED");

    const login = await api("POST", "/auth/login", undefined, {
      email: driverEmail,
      password: "moveos123",
    });
    expect(login.status).toBe(200);
    driverToken = login.body.token;

    const today = await api("GET", "/routes/driver/today", driverToken);
    expect(today.status).toBe(200);
    expect(today.body.id).toBe(routeId);

    const start = await api("POST", `/routes/${routeId}/start`, driverToken);
    expect(start.status).toBe(200);
  });

  it("rechaza re-despachar una ruta que ya no está PLANNED con 409 (conflicto de transición)", async () => {
    const res = await api("POST", `/routes/${routeId}/dispatch`, adminToken, {
      driverId,
    });
    expect(res.status).toBe(409);
  });

  it("escanea el paquete y registra la cadena de custodia (D3)", async () => {
    const order = await api("GET", `/orders/${firstStopOrderId}`, adminToken);
    const guia = order.body.trackingNumber as string;

    // Código equivocado: queda el evento de no-coincidencia.
    const wrong = await api("POST", `/routes/stops/${firstStopId}/scan`, driverToken, {
      code: "MV-NOEXISTE",
    });
    expect(wrong.status).toBe(200);
    expect(wrong.body.match).toBe(false);

    // Guía correcta (case-insensitive): vincula el bulto a la parada.
    const ok = await api("POST", `/routes/stops/${firstStopId}/scan`, driverToken, {
      code: guia.toLowerCase(),
    });
    expect(ok.status).toBe(200);
    expect(ok.body.match).toBe(true);

    const detail = await api("GET", `/orders/${firstStopOrderId}`, adminToken);
    const types = detail.body.events.map((e: { type: string }) => e.type);
    expect(types).toContain("SCANNED");
    expect(types).toContain("SCAN_MISMATCH");
  });

  it("reporta posición (tracking) y completa la entrega con POD georreferenciado", async () => {
    const ping = await api("POST", "/tracking/pings", driverToken, {
      lat: 4.6416,
      lng: -74.0639,
      speedKmh: 18,
      routeId,
    });
    expect(ping.status).toBe(201);

    const order = await api("GET", `/orders/${firstStopOrderId}`, adminToken);
    const complete = await api("POST", `/routes/stops/${firstStopId}/complete`, driverToken, {
      types: ["PHOTO", "GEOFENCE"],
      photoUrl: "https://files.example.com/pod/123.jpg",
      receivedBy: "Cliente",
      lat: order.body.lat,
      lng: order.body.lng,
    });
    expect(complete.status).toBe(200);
    expect(complete.body.geofenceOk).toBe(true);

    // La dirección quedó aprendida en el grafo de direcciones.
    const pin = await prisma.addressPin.findFirst({ where: { tenantId } });
    expect(pin).not.toBeNull();
    expect(pin!.source).toBe("DELIVERY_CONFIRMED");

    // La bitácora registró el ciclo de vida completo del pedido.
    const detail = await api("GET", `/orders/${firstStopOrderId}`, adminToken);
    const eventTypes = detail.body.events.map((e: { type: string }) => e.type);
    for (const expected of [
      "CREATED",
      "GEOCODED",
      "ASSIGNED",
      "DISPATCHED",
      "IN_TRANSIT",
      "DELIVERED",
    ]) {
      expect(eventTypes).toContain(expected);
    }
  });

  it("permite apagar un módulo y bloquea su API (modelo activable)", async () => {
    const off = await api("PATCH", "/modules/SAFETY", adminToken, { enabled: false });
    expect(off.status).toBe(200);

    const blocked = await api("GET", "/safety/alerts", adminToken);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("MODULE_NOT_ENABLED");

    const on = await api("PATCH", "/modules/SAFETY", adminToken, { enabled: true });
    expect(on.status).toBe(200);
    const allowed = await api("GET", "/safety/alerts", adminToken);
    expect(allowed.status).toBe(200);
  });

  it("el módulo EV reporta autonomía útil estimada", async () => {
    const overview = await api("GET", "/ev/overview", adminToken);
    expect(overview.status).toBe(200);
    expect(overview.body).toHaveLength(1);
    expect(overview.body[0].usableRangeKm).toBeGreaterThan(0);
    expect(overview.body[0].usableRangeKm).toBeLessThan(200);
  });

  it("registra alerta de pánico (módulo seguridad)", async () => {
    const panic = await api("POST", "/safety/panic", driverToken, {
      lat: 4.65,
      lng: -74.06,
      routeId,
    });
    expect(panic.status).toBe(201);

    const alerts = await api("GET", "/safety/alerts", adminToken);
    expect(alerts.status).toBe(200);
    expect(alerts.body.some((a: { type: string }) => a.type === "PANIC")).toBe(true);
  });

  it("analítica resume la operación", async () => {
    const summary = await api("GET", "/analytics/summary", adminToken);
    expect(summary.status).toBe(200);
    expect(summary.body.routesPlanned).toBeGreaterThan(0);
    expect(summary.body.stopsPerRoute).toBeGreaterThan(0);
  });
});
