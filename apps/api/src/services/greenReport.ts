import {
  co2BaselineKgForKm,
  co2KgForKm,
  TREE_ABSORPTION_KG_PER_YEAR,
  type VehicleType,
} from "@moveos/shared";
import { prisma } from "../lib/prisma.js";

/**
 * Informe verde mensual (CO₂): el argumento ESG de MoveOS.
 *
 * La distancia viene de las rutas planificadas del mes (Route.totalDistanceKm)
 * y la emisión del perfil del vehículo que las recorrió (tipo + propulsión).
 * El "ahorro" se mide contra la línea base de combustión: el mismo recorrido
 * hecho con el equivalente a gasolina del mercado.
 *
 * Atribución por pedido/cliente: la distancia de una ruta se reparte en partes
 * iguales entre sus paradas de ENTREGA (aproximación honesta y explicable en
 * un informe comercial; con OSRM real se puede pasar a tramos exactos).
 */

export const MONTH_RE = /^\d{4}-\d{2}$/;

export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

const round1 = (n: number) => Number(n.toFixed(1));
const round2 = (n: number) => Number(n.toFixed(2));

async function loadMonthRoutes(tenantId: string, month: string) {
  return prisma.route.findMany({
    // Route.date es "YYYY-MM-DD": el mes se filtra por prefijo.
    where: { tenantId, date: { startsWith: month }, status: { not: "CANCELLED" } },
    select: {
      id: true,
      date: true,
      totalDistanceKm: true,
      vehicle: { select: { plate: true, type: true, isElectric: true } },
      stops: {
        where: { kind: "DELIVERY" },
        select: {
          status: true,
          order: {
            select: {
              id: true,
              clientId: true,
              trackingNumber: true,
              customerName: true,
              status: true,
              deliveredAt: true,
            },
          },
        },
      },
    },
  });
}

interface GreenTotals {
  totalKm: number;
  co2Kg: number;
  co2BaselineKg: number;
  co2SavedKg: number;
  electricKm: number;
  electricSharePct: number | null;
  treesEquivalent: number;
}

function finishTotals(t: {
  totalKm: number;
  co2Kg: number;
  co2BaselineKg: number;
  electricKm: number;
}): GreenTotals {
  const saved = Math.max(t.co2BaselineKg - t.co2Kg, 0);
  return {
    totalKm: round1(t.totalKm),
    co2Kg: round2(t.co2Kg),
    co2BaselineKg: round2(t.co2BaselineKg),
    co2SavedKg: round2(saved),
    electricKm: round1(t.electricKm),
    electricSharePct:
      t.totalKm === 0 ? null : round1((t.electricKm / t.totalKm) * 100),
    treesEquivalent: round1(saved / TREE_ABSORPTION_KG_PER_YEAR),
  };
}

/** Informe verde del tenant: totales, por tipo de vehículo y por cliente. */
export async function tenantGreenReport(tenantId: string, month: string) {
  const routes = await loadMonthRoutes(tenantId, month);

  let totalKm = 0;
  let co2Kg = 0;
  let co2BaselineKg = 0;
  let electricKm = 0;
  let deliveredOrders = 0;

  const byType = new Map<
    string,
    { type: string; isElectric: boolean; km: number; co2Kg: number; co2BaselineKg: number; routes: number }
  >();
  const byClient = new Map<
    string | null,
    { clientId: string | null; deliveredOrders: number; km: number; co2Kg: number; co2BaselineKg: number }
  >();

  for (const route of routes) {
    const km = route.totalDistanceKm;
    const type = route.vehicle.type as VehicleType;
    const co2 = co2KgForKm(type, route.vehicle.isElectric, km);
    const baseline = co2BaselineKgForKm(type, km);

    totalKm += km;
    co2Kg += co2;
    co2BaselineKg += baseline;
    if (route.vehicle.isElectric || type === "BICICLETA") electricKm += km;

    const typeKey = `${type}:${route.vehicle.isElectric}`;
    const t = byType.get(typeKey) ?? {
      type,
      isElectric: route.vehicle.isElectric,
      km: 0,
      co2Kg: 0,
      co2BaselineKg: 0,
      routes: 0,
    };
    t.km += km;
    t.co2Kg += co2;
    t.co2BaselineKg += baseline;
    t.routes += 1;
    byType.set(typeKey, t);

    // Atribución por cliente: solo entregas logradas.
    if (route.stops.length === 0) continue;
    const kmPerStop = km / route.stops.length;
    const co2PerStop = co2 / route.stops.length;
    const baselinePerStop = baseline / route.stops.length;
    for (const stop of route.stops) {
      if (stop.order.status !== "DELIVERED") continue;
      deliveredOrders += 1;
      const c = byClient.get(stop.order.clientId) ?? {
        clientId: stop.order.clientId,
        deliveredOrders: 0,
        km: 0,
        co2Kg: 0,
        co2BaselineKg: 0,
      };
      c.deliveredOrders += 1;
      c.km += kmPerStop;
      c.co2Kg += co2PerStop;
      c.co2BaselineKg += baselinePerStop;
      byClient.set(stop.order.clientId, c);
    }
  }

  // Nombres de los negocios cliente para el desglose.
  const clientIds = [...byClient.keys()].filter((id): id is string => id !== null);
  const clients = clientIds.length
    ? await prisma.client.findMany({
        where: { id: { in: clientIds }, tenantId },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(clients.map((c) => [c.id, c.name]));

  return {
    month,
    ...finishTotals({ totalKm, co2Kg, co2BaselineKg, electricKm }),
    routes: routes.length,
    deliveredOrders,
    co2PerDeliveryKg:
      deliveredOrders === 0 ? null : round2(co2Kg / Math.max(deliveredOrders, 1)),
    byVehicleType: [...byType.values()]
      .map((t) => ({
        ...t,
        km: round1(t.km),
        co2Kg: round2(t.co2Kg),
        co2SavedKg: round2(Math.max(t.co2BaselineKg - t.co2Kg, 0)),
        co2BaselineKg: round2(t.co2BaselineKg),
      }))
      .sort((a, b) => b.km - a.km),
    byClient: [...byClient.values()]
      .map((c) => ({
        clientId: c.clientId,
        name: c.clientId ? (nameById.get(c.clientId) ?? "—") : "Sin negocio cliente",
        deliveredOrders: c.deliveredOrders,
        km: round1(c.km),
        co2Kg: round2(c.co2Kg),
        co2SavedKg: round2(Math.max(c.co2BaselineKg - c.co2Kg, 0)),
      }))
      .sort((a, b) => b.deliveredOrders - a.deliveredOrders),
  };
}

/** Informe verde de UN negocio cliente (lo que ve en su portal). */
export async function clientGreenReport(
  tenantId: string,
  clientId: string,
  month: string,
) {
  const routes = await loadMonthRoutes(tenantId, month);

  let totalKm = 0;
  let co2Kg = 0;
  let co2BaselineKg = 0;
  let electricKm = 0;
  const orders: Array<{
    orderId: string;
    trackingNumber: string | null;
    customerName: string;
    deliveredAt: Date | null;
    vehicle: { plate: string; type: string; isElectric: boolean };
    km: number;
    co2Kg: number;
    co2SavedKg: number;
  }> = [];

  for (const route of routes) {
    if (route.stops.length === 0) continue;
    const type = route.vehicle.type as VehicleType;
    const kmPerStop = route.totalDistanceKm / route.stops.length;
    const co2PerStop = co2KgForKm(type, route.vehicle.isElectric, kmPerStop);
    const baselinePerStop = co2BaselineKgForKm(type, kmPerStop);

    for (const stop of route.stops) {
      if (stop.order.clientId !== clientId) continue;
      if (stop.order.status !== "DELIVERED") continue;
      totalKm += kmPerStop;
      co2Kg += co2PerStop;
      co2BaselineKg += baselinePerStop;
      if (route.vehicle.isElectric || type === "BICICLETA") electricKm += kmPerStop;
      orders.push({
        orderId: stop.order.id,
        trackingNumber: stop.order.trackingNumber,
        customerName: stop.order.customerName,
        deliveredAt: stop.order.deliveredAt,
        vehicle: route.vehicle,
        km: round1(kmPerStop),
        co2Kg: round2(co2PerStop),
        co2SavedKg: round2(Math.max(baselinePerStop - co2PerStop, 0)),
      });
    }
  }

  orders.sort(
    (a, b) => (a.deliveredAt?.getTime() ?? 0) - (b.deliveredAt?.getTime() ?? 0),
  );

  return {
    month,
    ...finishTotals({ totalKm, co2Kg, co2BaselineKg, electricKm }),
    deliveredOrders: orders.length,
    co2PerDeliveryKg:
      orders.length === 0 ? null : round2(co2Kg / orders.length),
    orders,
  };
}
