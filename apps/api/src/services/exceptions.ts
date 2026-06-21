import { prisma } from "../lib/prisma.js";
import { slaDueAt } from "@moveos/shared";
import { LOW_CONFIDENCE_THRESHOLD } from "./geocoding.js";
import { todayBogota } from "./dailyMetrics.js";
import { toMinOfDayBogota } from "./routing.js";

/**
 * Cálculo del cockpit de excepciones: UNA cola priorizada con todo lo que
 * exige acción del despachador ahora. Lo consumen el endpoint /exceptions y
 * el Copiloto (que lo narra y propone acciones).
 */

const LATE_THRESHOLD_MIN = 20;
const STALE_PING_MIN = 15;
const LOW_BATTERY_PCT = 25;

export type ExceptionSeverity = "CRITICAL" | "HIGH" | "MEDIUM";

export interface ExceptionItem {
  id: string;
  type:
    | "PANIC"
    | "ROUTE_DEVIATION"
    | "ROUTE_LATE"
    | "VEHICLE_STALE"
    | "LOW_BATTERY"
    | "FAILED_DELIVERY"
    | "SLA_BREACH"
    | "ADDRESS_UNCONFIRMED";
  severity: ExceptionSeverity;
  title: string;
  detail: string;
  /** Acción sugerida que la UI sabe ejecutar con un clic. */
  action?:
    | { kind: "ACK_ALERT"; alertId: string }
    | { kind: "FLAG_RECOVERY"; orderId: string }
    | { kind: "OPEN_TRIAGE" }
    | { kind: "OPEN_ROUTE"; routeId: string }
    | { kind: "OPEN_MAP"; vehicleId: string };
  refs: Record<string, string | number | null>;
  createdAt: string;
}

const SEVERITY_RANK: Record<ExceptionSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
};

export async function computeExceptions(tenantId: string): Promise<ExceptionItem[]> {
  const today = todayBogota();
  const nowMin = toMinOfDayBogota(new Date());
  const items: ExceptionItem[] = [];

  // 1. Alertas de seguridad abiertas (pánico y desvío) — siempre primero.
  const alerts = await prisma.safetyAlert.findMany({
    where: { tenantId, status: "OPEN" },
    orderBy: { createdAt: "desc" },
  });
  for (const alert of alerts) {
    const panic = alert.type === "PANIC";
    items.push({
      id: `alert-${alert.id}`,
      type: panic ? "PANIC" : "ROUTE_DEVIATION",
      severity: panic ? "CRITICAL" : "HIGH",
      title: panic ? "Botón de pánico activado" : "Ruta desviada del corredor",
      detail: alert.details ?? alert.type,
      action: { kind: "ACK_ALERT", alertId: alert.id },
      refs: { routeId: alert.routeId, driverId: alert.driverId, lat: alert.lat, lng: alert.lng },
      createdAt: alert.createdAt.toISOString(),
    });
  }

  // 2. Rutas de hoy en ejecución: atraso vs el plan y telemetría muda.
  const activeRoutes = await prisma.route.findMany({
    where: { tenantId, date: today, status: "IN_PROGRESS" },
    include: {
      vehicle: true,
      driver: { select: { id: true, name: true } },
      stops: {
        where: { status: { in: ["PENDING", "ARRIVED"] } },
        orderBy: { sequence: "asc" },
        take: 1,
        include: { order: { select: { customerName: true } } },
      },
    },
  });
  for (const route of activeRoutes) {
    const next = route.stops[0];
    if (next) {
      const plannedMin = route.departureMin + next.etaMin;
      const lateBy = nowMin - plannedMin;
      if (lateBy > LATE_THRESHOLD_MIN) {
        items.push({
          id: `late-${route.id}`,
          type: "ROUTE_LATE",
          severity: lateBy > 60 ? "HIGH" : "MEDIUM",
          title: `Ruta ${route.vehicle.plate} va ${Math.round(lateBy)} min tarde`,
          detail: `Próxima parada (${next.order.customerName}) planeada para hace ${Math.round(lateBy)} min · conductor: ${route.driver?.name ?? "sin asignar"}`,
          action: { kind: "OPEN_ROUTE", routeId: route.id },
          refs: { routeId: route.id, vehicleId: route.vehicleId, lateByMin: Math.round(lateBy) },
          createdAt: new Date().toISOString(),
        });
      }
    }

    const lastSeen = route.vehicle.lastSeenAt;
    const staleMin = lastSeen
      ? (Date.now() - lastSeen.getTime()) / 60000
      : Number.POSITIVE_INFINITY;
    if (staleMin > STALE_PING_MIN) {
      items.push({
        id: `stale-${route.vehicleId}`,
        type: "VEHICLE_STALE",
        severity: "HIGH",
        title: `Sin señal de ${route.vehicle.plate}`,
        detail: lastSeen
          ? `Último ping hace ${Math.round(staleMin)} min con ruta en curso`
          : "Nunca ha reportado telemetría y tiene ruta en curso",
        action: { kind: "OPEN_MAP", vehicleId: route.vehicleId },
        refs: { routeId: route.id, vehicleId: route.vehicleId },
        createdAt: new Date().toISOString(),
      });
    }

    if (
      route.vehicle.isElectric &&
      route.vehicle.socPercent !== null &&
      route.vehicle.socPercent < LOW_BATTERY_PCT
    ) {
      items.push({
        id: `soc-${route.vehicleId}`,
        type: "LOW_BATTERY",
        severity: "MEDIUM",
        title: `EV ${route.vehicle.plate} con batería baja (${Math.round(route.vehicle.socPercent)}%)`,
        detail: "Ruta en curso: validar autonomía restante o planear carga",
        action: { kind: "OPEN_MAP", vehicleId: route.vehicleId },
        refs: { routeId: route.id, vehicleId: route.vehicleId, soc: route.vehicle.socPercent },
        createdAt: new Date().toISOString(),
      });
    }
  }

  // 3. Entregas fallidas sin recuperación iniciada (últimas 48 h).
  const failed = await prisma.order.findMany({
    where: {
      tenantId,
      status: { in: ["FAILED", "REJECTED"] },
      recoveryStatus: "NONE",
      createdAt: { gte: new Date(Date.now() - 48 * 3600_000) },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      trackingNumber: true,
      customerName: true,
      failureReason: true,
      createdAt: true,
      client: { select: { name: true } },
    },
  });
  for (const order of failed) {
    items.push({
      id: `failed-${order.id}`,
      type: "FAILED_DELIVERY",
      severity: "MEDIUM",
      title: `Entrega fallida ${order.trackingNumber ?? ""}`.trim(),
      detail: `${order.customerName} · ${order.failureReason ?? "sin motivo"} · ${order.client?.name ?? "sin comercio"} — marcar para reprogramación del comercio`,
      action: { kind: "FLAG_RECOVERY", orderId: order.id },
      refs: { orderId: order.id, trackingNumber: order.trackingNumber },
      createdAt: order.createdAt.toISOString(),
    });
  }

  // 3b. SLA en riesgo (D3): pedidos aún no entregados cuyo servicio tiene un
  // plazo (completionDeadlineMin) ya vencido o por vencer. Incumplido = HIGH;
  // por vencer (dentro de la ventana) = MEDIUM. Sin acción de un clic: el
  // despachador prioriza/replanifica desde Pedidos.
  const SLA_PREDICT_WINDOW_MIN = 30;
  const slaCandidates = await prisma.order.findMany({
    where: {
      tenantId,
      serviceId: { not: null },
      status: { notIn: ["DELIVERED", "FAILED", "REJECTED", "CANCELLED"] },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: {
      id: true,
      trackingNumber: true,
      customerName: true,
      createdAt: true,
      client: { select: { name: true } },
      service: { select: { name: true, completionDeadlineMin: true } },
    },
  });
  const slaNow = Date.now();
  for (const order of slaCandidates) {
    if (!order.service) continue;
    const dueAt = slaDueAt(order.createdAt, order.service.completionDeadlineMin);
    const minsToDue = (dueAt.getTime() - slaNow) / 60000;
    const breached = minsToDue < 0;
    if (!breached && minsToDue > SLA_PREDICT_WINDOW_MIN) continue;
    const who = order.trackingNumber ?? order.customerName;
    const comercio = order.client?.name ?? "sin comercio";
    items.push({
      id: `sla-${order.id}`,
      type: "SLA_BREACH",
      severity: breached ? "HIGH" : "MEDIUM",
      title: breached
        ? `SLA incumplido: ${who} (${order.service.name})`
        : `SLA por vencer: ${who} (${order.service.name})`,
      detail: breached
        ? `Venció hace ${Math.round(-minsToDue)} min · ${comercio} — priorizar o reprogramar`
        : `Vence en ${Math.round(minsToDue)} min · ${comercio} — despachar pronto`,
      refs: {
        orderId: order.id,
        trackingNumber: order.trackingNumber,
        dueAt: dueAt.toISOString(),
      },
      createdAt: order.createdAt.toISOString(),
    });
  }

  // 4. Direcciones sin confirmar en pedidos por planificar (resumen).
  const unconfirmed = await prisma.order.count({
    where: {
      tenantId,
      status: { in: ["PENDING", "GEOCODED", "ASSIGNED"] },
      addressVerifiedAt: null,
      OR: [
        { geoConfidence: { lt: LOW_CONFIDENCE_THRESHOLD } },
        { geoConfidence: null },
        { geocodeSource: "MOCK" },
      ],
    },
  });
  if (unconfirmed > 0) {
    items.push({
      id: "triage-pending",
      type: "ADDRESS_UNCONFIRMED",
      severity: "MEDIUM",
      title: `${unconfirmed} dirección(es) de baja confianza por revisar`,
      detail:
        "Revisarlas antes de planificar evita entregas fallidas — abrir la cola de triage",
      action: { kind: "OPEN_TRIAGE" },
      refs: { count: unconfirmed },
      createdAt: new Date().toISOString(),
    });
  }

  // Excluir las excepciones pospuestas por el despachador (aplazo vigente). La
  // excepción no se persiste; solo el aplazo, reevaluado contra el cálculo en
  // vivo: si la condición sigue al expirar `until`, la excepción reaparece.
  const snoozes = await prisma.snoozedException.findMany({
    where: { tenantId, until: { gt: new Date() } },
    select: { key: true },
  });
  const snoozed = new Set(snoozes.map((s) => s.key));
  const visible = snoozed.size ? items.filter((i) => !snoozed.has(i.id)) : items;

  visible.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.createdAt.localeCompare(a.createdAt),
  );
  return visible;
}
