import { Fragment, useState } from "react";
import { api } from "../api";
import { useRealtimeReload } from "../realtime";
import {
  Banner,
  Card,
  EmptyState,
  Loading,
  PageHeader,
  StatusBadge,
  tableRowClass,
  theadRowClass,
} from "../components/ui";

/**
 * Portal de clientes — "Mis envíos": el negocio ve solo sus pedidos, con el
 * enlace público de rastreo listo para reenviar a su consumidor final.
 */

interface PortalOrder {
  id: string;
  trackingNumber: string | null;
  externalRef: string | null;
  customerName: string;
  addressRaw: string;
  pickupAddressRaw: string | null;
  status: string;
  weightKg: number;
  failureReason: string | null;
  deliveredAt: string | null;
  recoveryStatus: string;
  createdAt: string;
  trackingUrl: string | null;
}

interface PortalEvent {
  type: string;
  details: string | null;
  createdAt: string;
}

interface Summary {
  month: string;
  createdThisMonth: number;
  deliveredThisMonth: number;
  byStatus: { status: string; count: number }[];
}

const EVENT_LABELS: Record<string, string> = {
  CREATED: "Envío registrado",
  GEOCODED: "Dirección confirmada",
  ASSIGNED: "Asignado a ruta",
  DISPATCHED: "Salió a reparto",
  IN_TRANSIT: "En camino",
  ARRIVED: "Conductor en el punto",
  PICKED_UP: "Recogido en origen",
  DELIVERED: "Entregado",
  FAILED: "Entrega no lograda",
  NOTIFIED: "Confirmación enviada",
};

export default function PortalPedidos() {
  const [orders, setOrders] = useState<PortalOrder[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, PortalEvent[]>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState<string | null>(null);
  const [rescheduleMsg, setRescheduleMsg] = useState<string | null>(null);

  async function load() {
    try {
      const [list, sum] = await Promise.all([
        api<PortalOrder[]>("GET", "/portal/orders"),
        api<Summary>("GET", "/portal/summary"),
      ]);
      setOrders(list);
      setSummary(sum);
    } finally {
      setLoading(false);
    }
  }
  // Tiempo real: el servidor avisa cuando un envío del negocio cambia de estado.
  useRealtimeReload(["order"], () => void load());

  async function toggleTimeline(orderId: string) {
    if (expanded === orderId) {
      setExpanded(null);
      return;
    }
    const detail = await api<{ events: PortalEvent[] }>(
      "GET",
      `/portal/orders/${orderId}`,
    );
    setEvents((e) => ({ ...e, [orderId]: detail.events }));
    setExpanded(orderId);
  }

  async function copyTracking(order: PortalOrder) {
    if (!order.trackingUrl) return;
    await navigator.clipboard.writeText(order.trackingUrl);
    setCopied(order.id);
    setTimeout(() => setCopied(null), 1500);
  }

  /**
   * Reprogramación B2B de una entrega fallida: crea un nuevo envío con la
   * misma carga y destino, enlazado al fallido. El flujo es del comercio —
   * nunca se contacta al consumidor final.
   */
  async function reschedule(order: PortalOrder) {
    setRescheduling(order.id);
    setRescheduleMsg(null);
    try {
      const reorder = await api<{ trackingNumber: string | null }>(
        "POST",
        `/portal/orders/${order.id}/reschedule`,
      );
      setRescheduleMsg(
        `Reenvío creado con guía ${reorder.trackingNumber ?? ""} — saldrá en la próxima planificación`,
      );
      await load();
    } catch (err) {
      setRescheduleMsg(err instanceof Error ? err.message : "Error al reprogramar");
    } finally {
      setRescheduling(null);
    }
  }

  const inCourse = orders.filter((o) =>
    ["ASSIGNED", "IN_TRANSIT"].includes(o.status),
  ).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Mis envíos"
        subtitle="Estado en vivo de todo lo que tu operador mueve por ti. Comparte el
          enlace de rastreo con tu cliente final."
      />

      {rescheduleMsg && (
        <Banner kind="info" onDismiss={() => setRescheduleMsg(null)}>
          {rescheduleMsg}
        </Banner>
      )}

      {summary && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <div className="text-2xl font-bold text-navy">{summary.createdThisMonth}</div>
            <div className="text-xs text-navy/50">envíos este mes</div>
          </Card>
          <Card>
            <div className="text-2xl font-bold text-navy">{summary.deliveredThisMonth}</div>
            <div className="text-xs text-navy/50">entregados este mes</div>
          </Card>
          <Card>
            <div className="text-2xl font-bold text-navy">{inCourse}</div>
            <div className="text-xs text-navy/50">en curso ahora</div>
          </Card>
        </div>
      )}

      <Card>
        {loading ? (
          <Loading label="Cargando sus envíos…" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={theadRowClass}>
                  <th className="py-2">Guía</th>
                  <th>Destinatario</th>
                  <th>Dirección</th>
                  <th>Estado</th>
                  <th>Creado</th>
                  <th>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <Fragment key={o.id}>
                    <tr className={tableRowClass}>
                      <td className="py-2 font-mono text-xs font-medium">
                        {o.trackingNumber}
                        {o.externalRef && (
                          <div className="text-navy/40">ref: {o.externalRef}</div>
                        )}
                      </td>
                      <td>{o.customerName}</td>
                      <td className="max-w-[220px] truncate" title={o.addressRaw}>
                        {o.addressRaw}
                      </td>
                      <td>
                        <StatusBadge status={o.status} />
                        {o.failureReason && (
                          <div className="text-xs text-red-600">{o.failureReason}</div>
                        )}
                      </td>
                      <td className="text-xs text-navy/50">
                        {new Date(o.createdAt).toLocaleDateString("es-CO")}
                      </td>
                      <td className="space-x-2 whitespace-nowrap text-right text-xs">
                        {["FAILED", "REJECTED"].includes(o.status) &&
                          o.recoveryStatus !== "RESCHEDULED" && (
                            <button
                              onClick={() => void reschedule(o)}
                              disabled={rescheduling === o.id}
                              className="rounded bg-lima px-2 py-1 font-bold text-navy disabled:opacity-50"
                            >
                              {rescheduling === o.id ? "…" : "Reprogramar"}
                            </button>
                          )}
                        {o.recoveryStatus === "RESCHEDULED" && (
                          <span className="text-emerald-700">↻ Reprogramado</span>
                        )}
                        {o.trackingUrl && (
                          <button
                            onClick={() => void copyTracking(o)}
                            className="text-navy/60 underline-offset-2 hover:underline"
                          >
                            {copied === o.id ? "¡Copiado!" : "Copiar rastreo"}
                          </button>
                        )}
                        <button
                          onClick={() => void toggleTimeline(o.id)}
                          aria-expanded={expanded === o.id}
                          className="text-navy/60 underline-offset-2 hover:underline"
                        >
                          {expanded === o.id ? "Ocultar" : "Historial"}
                        </button>
                      </td>
                    </tr>
                    {expanded === o.id && (
                      <tr className={`bg-niebla/40 ${tableRowClass}`}>
                        <td colSpan={6} className="px-4 py-3">
                          <ol className="space-y-1 text-xs">
                            {(events[o.id] ?? []).map((e, i) => (
                              <li key={i} className="flex items-baseline gap-2">
                                <span className="font-mono text-navy/40">
                                  {new Date(e.createdAt).toLocaleString("es-CO", {
                                    day: "2-digit",
                                    month: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-lima" />
                                <span className="font-medium">
                                  {EVENT_LABELS[e.type] ?? e.type}
                                </span>
                                {e.details && (
                                  <span className="text-navy/50">{e.details}</span>
                                )}
                              </li>
                            ))}
                          </ol>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {orders.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState>
                        Aún no tienes envíos. Crea el primero en «Nuevo envío».
                      </EmptyState>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
