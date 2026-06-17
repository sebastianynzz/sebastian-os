import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Propiedades personalizadas de parada (Tier 2 §9): el tenant define campos
 * extra con visibilidad por campo; el valor por pedido vive en
 * Order.customFields. Verifica CRUD + tope por plan (upsell), persistencia
 * filtrada, y que cada audiencia (conductor / destinatario) vea SOLO sus
 * campos. Mutaciones solo ADMIN; tenant-scoped; B2B.
 */
const runId = Date.now();
const adminEmail = `cprops+${runId}@test.moveos.co`;
const portalEmail = `cpropscli+${runId}@test.moveos.co`;
const driverEmail = `cpropsdrv+${runId}@test.moveos.co`;

let app: FastifyInstance;
let tenantId: string;
let adminToken: string;
let portalToken: string;
let driverToken: string;
let pisoId: string;
let mensajeId: string;
let notaId: string;
let orderId: string;
let trackingToken: string;

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
    tenantName: "Custom Props Co",
    adminName: "Admin",
    city: "Bogotá",
    email: adminEmail,
    password: "moveos123",
  });
  tenantId = reg.body!.tenant.id;
  adminToken = reg.body!.token;

  const client = await api("POST", "/clients", adminToken, {
    name: "Comercio CP",
    notifyChannel: "IN_APP",
  });
  await api("POST", `/clients/${client.body.id}/portal-access`, adminToken, {
    email: portalEmail,
    password: "moveos123",
  });
  portalToken = (
    await api("POST", "/auth/login", undefined, {
      email: portalEmail,
      password: "moveos123",
    })
  ).body.token;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

describe("Propiedades personalizadas de parada (Tier 2 §9)", () => {
  it("crea campos con visibilidad por audiencia (solo ADMIN)", async () => {
    const piso = await api("POST", "/custom-properties", adminToken, {
      name: "Piso",
      visibleToDriver: true,
      visibleToRecipient: false,
    });
    expect(piso.status).toBe(201);
    pisoId = piso.body.id;

    const mensaje = await api("POST", "/custom-properties", adminToken, {
      name: "Mensaje al cliente",
      visibleToDriver: false,
      visibleToRecipient: true,
    });
    expect(mensaje.status).toBe(201);
    mensajeId = mensaje.body.id;

    const nota = await api("POST", "/custom-properties", adminToken, {
      name: "Nota interna",
      visibleToDriver: false,
      visibleToRecipient: false,
    });
    expect(nota.status).toBe(201);
    notaId = nota.body.id;
  });

  it("el rol CLIENT del portal no puede crear campos (403)", async () => {
    const res = await api("POST", "/custom-properties", portalToken, {
      name: "Hack",
    });
    expect(res.status).toBe(403);
  });

  it("GET devuelve los campos + el tope del plan (contexto de upsell)", async () => {
    const res = await api("GET", "/custom-properties", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
    expect(res.body.plan).toBe("FREE");
    expect(res.body.cap).toBe(3);
    expect(res.body.used).toBe(3);
  });

  it("tope por plan: el 4° campo en FREE devuelve 409 con upsell", async () => {
    const res = await api("POST", "/custom-properties", adminToken, {
      name: "Cuarto",
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CUSTOM_PROPERTY_LIMIT");
    expect(res.body.cap).toBe(3);
  });

  it("crea un pedido con customFields; ignora claves desconocidas", async () => {
    const order = await api("POST", "/orders", adminToken, {
      customerName: "Destino CP",
      customerPhone: "+573111111170",
      addressRaw: "Cra 13 # 54-20",
      lat: 4.6416,
      lng: -74.0639,
      customFields: {
        [pisoId]: "3",
        [mensajeId]: "Dejar en portería",
        [notaId]: "Frágil",
        claveDesconocida: "x", // no es una propiedad del tenant → se ignora
      },
    });
    expect(order.status).toBe(201);
    orderId = order.body.id;
    trackingToken = order.body.trackingToken;

    const detail = await api("GET", `/orders/${orderId}`, adminToken);
    expect(detail.body.customFields[pisoId]).toBe("3");
    expect(detail.body.customFields[mensajeId]).toBe("Dejar en portería");
    expect(detail.body.customFields[notaId]).toBe("Frágil");
    expect(detail.body.customFields.claveDesconocida).toBeUndefined();
  });

  it("el rastreo público muestra SOLO los campos visibles al destinatario", async () => {
    const res = await api("GET", `/track/${trackingToken}`);
    expect(res.status).toBe(200);
    expect(res.body.customProperties).toEqual([
      { id: mensajeId, name: "Mensaje al cliente", value: "Dejar en portería" },
    ]);
  });

  it("la app del conductor ve SOLO los campos visibles al conductor (sin JSON crudo)", async () => {
    const vehicle = await api("POST", "/vehicles", adminToken, {
      plate: "CPX1Z9",
      type: "IONAX",
      capacityKg: 600,
      isElectric: true,
      nominalRangeKm: 200,
    });
    const driver = await api("POST", "/drivers", adminToken, {
      name: "Conductor CP",
      phone: "+573000000077",
      documentId: `77${runId}`.slice(0, 12),
      email: driverEmail,
      password: "moveos123",
    });

    const plan = await api("POST", "/optimization/plans", adminToken, {
      date: "2026-06-14", // domingo: sin pico y placa
      depot: { lat: 4.6486, lng: -74.0628 },
      orderIds: [orderId],
      vehicleIds: [vehicle.body.id],
    });
    expect(plan.status).toBe(201);
    const routeId = plan.body.routes[0].id;
    await api("POST", `/routes/${routeId}/dispatch`, adminToken, {
      driverId: driver.body.id,
    });

    driverToken = (
      await api("POST", "/auth/login", undefined, {
        email: driverEmail,
        password: "moveos123",
      })
    ).body.token;

    const today = await api("GET", "/routes/driver/today", driverToken);
    expect(today.status).toBe(200);
    const stop = today.body.stops.find(
      (s: any) => s.orderId === orderId && s.kind === "DELIVERY",
    );
    expect(stop.order.customProperties).toEqual([
      { id: pisoId, name: "Piso", value: "3" },
    ]);
    // El JSON crudo nunca llega a la app: solo los campos visibles, etiquetados.
    expect(stop.order.customFields).toBeUndefined();
  });

  it("el portal lista los campos del operador para rellenarlos", async () => {
    const res = await api("GET", "/portal/custom-properties", portalToken);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body.map((p: any) => p.name)).toContain("Piso");
    expect(res.body[0]).toHaveProperty("id");
    expect(res.body[0]).not.toHaveProperty("visibleToDriver");
  });

  it("PATCH cambia la visibilidad; DELETE quita el campo (tenant-scoped)", async () => {
    const patch = await api("PATCH", `/custom-properties/${notaId}`, adminToken, {
      visibleToRecipient: true,
    });
    expect(patch.status).toBe(200);
    expect(patch.body.visibleToRecipient).toBe(true);

    const del = await api("DELETE", `/custom-properties/${notaId}`, adminToken);
    expect(del.status).toBe(204);
    const after = await api("GET", "/custom-properties", adminToken);
    expect(after.body.used).toBe(2);
  });
});
