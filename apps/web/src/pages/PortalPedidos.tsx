import { Fragment, useState } from "react";
import { Check, Copy, PackageOpen, RotateCw } from "lucide-react";
import { api } from "../api";
import { formatDateBogota, formatShortBogota } from "../format";
import { useRealtimeReload } from "../realtime";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  KpiCard,
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
          <KpiCard label="Envíos este mes" value={summary.createdThisMonth} />
          <KpiCard label="Entregados" value={summary.deliveredThisMonth} accent />
          <KpiCard label="En curso ahora" value={inCourse} tone="hero" />
        </div>
      )}

      <Card>
        {loading ? (
          <Loading label="Cargando tus envíos…" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-asfalto">
              <thead>
                <tr className={theadRowClass}>
                  <th className="w-[140px] py-2 font-semibold">Guía</th>
                  <th className="font-semibold">Destinatario</th>
                  <th className="w-[110px] font-semibold">Estado</th>
                  <th className="w-[110px] font-semibold">Creado</th>
                  <th className="w-[250px]">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const failed = ["FAILED", "REJECTED"].includes(o.status);
                  return (
                    <Fragment key={o.id}>
                      <tr
                        className={`${tableRowClass} ${
                          failed ? "bg-danger-bg/40 hover:bg-danger-bg/60" : ""
                        }`}
                      >
                        <td
                          className={`py-2.5 ${
                            failed ? "border-l-[3px] border-l-danger pl-1.5" : ""
                          }`}
                        >
                          <span className="font-mono text-xs font-semibold">
                            {o.trackingNumber}
                          </span>
                          {o.externalRef && (
                            <span className="block text-[11px] text-text-tertiary">
                              ref: {o.externalRef}
                            </span>
                          )}
                        </td>
                        <td>
                          <span className="font-medium">{o.customerName}</span>
                          <span
                            className="block max-w-[260px] truncate text-[11px] text-text-tertiary"
                            title={o.addressRaw}
                          >
                            {o.addressRaw}
                          </span>
                          {failed && (
                            <span className="block text-[11px] text-danger">
                              Entrega no lograda
                              {o.failureReason && <> · «{o.failureReason}»</>}
                            </span>
                          )}
                        </td>
                        <td>
                          <StatusBadge status={o.status} />
                        </td>
                        <td className="whitespace-nowrap font-mono text-xs text-text-tertiary">
                          {formatDateBogota(o.createdAt)}
                        </td>
                        <td className="whitespace-nowrap py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {failed && o.recoveryStatus !== "RESCHEDULED" && (
                              <Button
                                variant="cta"
                                onClick={() => void reschedule(o)}
                                disabled={rescheduling === o.id}
                              >
                                {rescheduling === o.id ? "Reprogramando…" : "Reprogramar"}
                              </Button>
                            )}
                            {o.recoveryStatus === "RESCHEDULED" && (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                                <RotateCw
                                  aria-hidden="true"
                                  className="h-3 w-3"
                                  strokeWidth={2.5}
                                />
                                Reprogramado
                              </span>
                            )}
                            {o.trackingUrl && (
                              <Button
                                variant="secondary"
                                icon={
                                  copied === o.id ? (
                                    <Check strokeWidth={2} />
                                  ) : (
                                    <Copy strokeWidth={2} />
                                  )
                                }
                                onClick={() => void copyTracking(o)}
                              >
                                {copied === o.id ? "¡Copiado!" : "Copiar rastreo"}
                              </Button>
                            )}
                            <button
                              onClick={() => void toggleTimeline(o.id)}
                              aria-expanded={expanded === o.id}
                              className="text-xs text-text-tertiary transition duration-200 ease-brand hover:text-asfalto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-asfalto"
                            >
                              {expanded === o.id ? "Ocultar" : "Historial"}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded === o.id && (
                        <tr className={`bg-canvas/40 ${tableRowClass}`}>
                          <td colSpan={5} className="px-4 py-3">
                            <ol className="space-y-1 text-xs">
                              {(events[o.id] ?? []).map((e, i) => (
                                <li key={i} className="flex items-baseline gap-2">
                                  <span className="font-mono text-text-tertiary">
                                    {formatShortBogota(e.createdAt)}
                                  </span>
                                  <span
                                    aria-hidden="true"
                                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-verde"
                                  />
                                  <span className="font-medium">
                                    {EVENT_LABELS[e.type] ?? e.type}
                                  </span>
                                  {e.details && (
                                    <span className="text-text-secondary">{e.details}</span>
                                  )}
                                </li>
                              ))}
                            </ol>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {orders.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState
                        icon={
                          <PackageOpen
                            aria-hidden="true"
                            className="h-8 w-8"
                            strokeWidth={1.75}
                          />
                        }
                      >
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
