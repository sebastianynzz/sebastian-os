import { slaDueAt } from "@moveos/shared";
import { prisma } from "../lib/prisma.js";
import { bogotaUtcRange } from "./dailyMetrics.js";

/**
 * Informe de cumplimiento de SLA por negocio cliente (D3b). Para cada pedido con
 * un Service (promesa de entrega), la hora límite es determinista
 * (createdAt + plazo del servicio, vía `slaDueAt`). Clasificamos cada pedido en:
 *  - onTime  (a tiempo): entregado antes o en la hora límite.
 *  - breached (incumplido): entregado tarde, o aún sin entregar con la hora ya vencida.
 *  - pending (en curso): sin entregar y dentro del plazo.
 * Base del seguimiento de SLA y de la facturación B2B. Tenant-scoped.
 */

export interface ClientSlaRow {
  clientId: string | null;
  clientName: string;
  total: number;
  onTime: number;
  breached: number;
  pending: number;
  /** Incumplidos / (a tiempo + incumplidos). null si no hay pedidos resueltos. */
  breachRate: number | null;
}

export interface SlaReport {
  from: string;
  to: string;
  totals: Omit<ClientSlaRow, "clientId" | "clientName">;
  byClient: ClientSlaRow[];
}

const TERMINAL_UNDELIVERED = ["FAILED", "REJECTED", "CANCELLED"];

function breachRate(breached: number, onTime: number): number | null {
  const resolved = breached + onTime;
  return resolved === 0 ? null : breached / resolved;
}

export async function tenantSlaReport(
  tenantId: string,
  from: string,
  to: string,
): Promise<SlaReport> {
  const { start, end } = bogotaUtcRange(from, to);
  const orders = await prisma.order.findMany({
    where: {
      tenantId,
      serviceId: { not: null },
      createdAt: { gte: start, lt: end },
    },
    select: {
      createdAt: true,
      deliveredAt: true,
      status: true,
      clientId: true,
      client: { select: { name: true } },
      service: { select: { completionDeadlineMin: true } },
    },
  });

  const now = new Date();
  const groups = new Map<string, ClientSlaRow>();
  let total = 0;
  let onTime = 0;
  let breached = 0;
  let pending = 0;

  for (const order of orders) {
    if (!order.service) continue;
    const dueAt = slaDueAt(order.createdAt, order.service.completionDeadlineMin);
    let bucket: "onTime" | "breached" | "pending";
    if (order.status === "DELIVERED") {
      bucket =
        order.deliveredAt && order.deliveredAt.getTime() <= dueAt.getTime()
          ? "onTime"
          : "breached";
    } else if (
      TERMINAL_UNDELIVERED.includes(order.status) ||
      now.getTime() > dueAt.getTime()
    ) {
      // Terminal sin entregar, o aún en vuelo con la hora ya vencida: incumplido
      // si la hora límite ya pasó; si no, sigue en curso.
      bucket = now.getTime() > dueAt.getTime() ? "breached" : "pending";
    } else {
      bucket = "pending";
    }

    const key = order.clientId ?? "__none__";
    const row =
      groups.get(key) ??
      {
        clientId: order.clientId,
        clientName: order.client?.name ?? "Sin negocio asignado",
        total: 0,
        onTime: 0,
        breached: 0,
        pending: 0,
        breachRate: null,
      };
    row.total += 1;
    row[bucket] += 1;
    groups.set(key, row);

    total += 1;
    if (bucket === "onTime") onTime += 1;
    else if (bucket === "breached") breached += 1;
    else pending += 1;
  }

  const byClient = [...groups.values()]
    .map((r) => ({ ...r, breachRate: breachRate(r.breached, r.onTime) }))
    .sort((a, b) => b.breached - a.breached || b.total - a.total);

  return {
    from,
    to,
    totals: { total, onTime, breached, pending, breachRate: breachRate(breached, onTime) },
    byClient,
  };
}
