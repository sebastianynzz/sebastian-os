import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatShortBogota } from "@moveos/shared";
import { api } from "../api";
import { canOfferStaffPush, enableStaffPush } from "../push";
import { useRealtimeReload } from "../realtime";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Loading,
  PageHeader,
} from "../components/ui";

/**
 * Cockpit de excepciones: la pantalla de inicio operativa del día. Una sola
 * cola priorizada (pánico, desvíos, rutas tarde, vehículos mudos, batería
 * baja, entregas fallidas, direcciones sin confirmar) con acción de un clic,
 * filtros por severidad/tipo y "posponer" para aplazar lo no urgente.
 */

type Severity = "CRITICAL" | "HIGH" | "MEDIUM";

interface ExceptionItem {
  id: string;
  type: string;
  severity: Severity;
  title: string;
  detail: string;
  action?:
    | { kind: "ACK_ALERT"; alertId: string }
    | { kind: "FLAG_RECOVERY"; orderId: string }
    | { kind: "OPEN_TRIAGE" }
    | { kind: "OPEN_ROUTE"; routeId: string }
    | { kind: "OPEN_MAP"; vehicleId: string };
  createdAt: string;
}
interface Snoozed {
  key: string;
  until: string;
}

const SEVERITY_STYLES: Record<Severity, string> = {
  CRITICAL: "border-l-4 border-danger bg-danger-bg",
  HIGH: "border-l-4 border-warning bg-warning-bg",
  MEDIUM: "border-l-4 border-cielo bg-white",
};

const SEVERITIES: Severity[] = ["CRITICAL", "HIGH", "MEDIUM"];
const SEVERITY_LABELS: Record<Severity, string> = {
  CRITICAL: "Críticas",
  HIGH: "Altas",
  MEDIUM: "Medias",
};

const TYPE_ICONS: Record<string, string> = {
  PANIC: "🚨",
  ROUTE_DEVIATION: "🛣️",
  ROUTE_LATE: "⏱️",
  VEHICLE_STALE: "📡",
  LOW_BATTERY: "🔋",
  FAILED_DELIVERY: "📦",
  SLA_BREACH: "⏳",
  ADDRESS_UNCONFIRMED: "📍",
  DOC_EXPIRY: "📄",
};
const TYPE_LABELS: Record<string, string> = {
  PANIC: "Pánico",
  ROUTE_DEVIATION: "Desvío",
  ROUTE_LATE: "Ruta tarde",
  VEHICLE_STALE: "Sin señal",
  LOW_BATTERY: "Batería baja",
  FAILED_DELIVERY: "Entrega fallida",
  SLA_BREACH: "SLA",
  ADDRESS_UNCONFIRMED: "Dirección",
  DOC_EXPIRY: "Documento",
};
// Etiqueta legible para la sección de pospuestas (a partir del prefijo del
// `key` estable: alert-…, late-…, stale-…, soc-…, failed-…, triage-…).
const KEY_PREFIX_LABELS: Record<string, string> = {
  alert: "Alerta de seguridad",
  late: "Ruta tarde",
  stale: "Vehículo sin señal",
  soc: "Batería baja",
  failed: "Entrega fallida",
  sla: "SLA en riesgo",
  triage: "Direcciones por confirmar",
  doc: "Documento por vencer",
};

// Presets de aplazo ofrecidos en cada tarjeta.
const SNOOZE_OPTIONS = [
  { minutes: 60, label: "1 h" },
  { minutes: 240, label: "4 h" },
  { minutes: 1440, label: "1 día" },
];

export default function Excepciones() {
  const [items, setItems] = useState<ExceptionItem[] | null>(null);
  const [snoozed, setSnoozed] = useState<Snoozed[]>([]);
  const [banner, setBanner] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pushOffer, setPushOffer] = useState(canOfferStaffPush());
  const [sevFilter, setSevFilter] = useState<Set<Severity>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: ExceptionItem[]; snoozed: Snoozed[] }>(
        "GET",
        "/exceptions",
      );
      setItems(res.items);
      setSnoozed(res.snoozed);
    } catch {
      // el sondeo de respaldo reintenta
    }
  }, []);

  useRealtimeReload(["order", "safety", "telemetry"], load, { fallbackMs: 30_000 });

  function toggle<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  const typesPresent = useMemo(
    () => [...new Set((items ?? []).map((i) => i.type))],
    [items],
  );
  const filtered = useMemo(
    () =>
      (items ?? []).filter(
        (i) =>
          (sevFilter.size === 0 || sevFilter.has(i.severity)) &&
          (typeFilter.size === 0 || typeFilter.has(i.type)),
      ),
    [items, sevFilter, typeFilter],
  );

  async function runAction(item: ExceptionItem) {
    if (!item.action) return;
    setBusyId(item.id);
    setBanner(null);
    try {
      if (item.action.kind === "ACK_ALERT") {
        await api("PATCH", `/safety/alerts/${item.action.alertId}`, {
          status: "ACKNOWLEDGED",
        });
        setBanner({ kind: "success", text: "Alerta marcada como atendida" });
      } else if (item.action.kind === "FLAG_RECOVERY") {
        await api("POST", `/orders/${item.action.orderId}/recovery/flag`);
        setBanner({
          kind: "success",
          text: "Comercio notificado: podrá reprogramar la entrega desde su portal",
        });
      }
      await load();
    } catch (err) {
      setBanner({ kind: "error", text: err instanceof Error ? err.message : "Error" });
    } finally {
      setBusyId(null);
    }
  }

  async function snooze(item: ExceptionItem, minutes: number) {
    setBusyId(item.id);
    setBanner(null);
    try {
      await api("POST", "/exceptions/snooze", { key: item.id, minutes });
      await load();
    } catch (err) {
      setBanner({ kind: "error", text: err instanceof Error ? err.message : "Error" });
    } finally {
      setBusyId(null);
    }
  }

  async function unsnooze(key: string) {
    setBanner(null);
    try {
      await api("DELETE", `/exceptions/snooze/${encodeURIComponent(key)}`);
      await load();
    } catch (err) {
      setBanner({ kind: "error", text: err instanceof Error ? err.message : "Error" });
    }
  }

  if (!items) return <Loading label="Calculando excepciones…" />;

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition ${
      active ? "bg-navy text-white" : "bg-niebla text-navy/70 hover:bg-cielo/40"
    }`;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Excepciones"
        subtitle="Todo lo que requiere tu acción ahora, en una sola cola priorizada."
      />
      {banner && (
        <Banner kind={banner.kind} onDismiss={() => setBanner(null)}>
          {banner.text}
        </Banner>
      )}

      {/* P0.6: sin esta suscripción, el push de pánico no tiene a quién llegar. */}
      {pushOffer && (
        <Banner kind="info" onDismiss={() => setPushOffer(false)}>
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Recibe el botón de pánico y alertas críticas aunque el dashboard
              esté cerrado.
            </span>
            <button
              onClick={async () => {
                const ok = await enableStaffPush();
                setPushOffer(false);
                setBanner(
                  ok
                    ? { kind: "success", text: "🔔 Avisos activados en este dispositivo." }
                    : { kind: "error", text: "No se pudieron activar los avisos." },
                );
              }}
              className="shrink-0 rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-white"
            >
              🔔 Activar avisos
            </button>
          </span>
        </Banner>
      )}

      {items.length === 0 && snoozed.length === 0 ? (
        <Card>
          <EmptyState phrase="El motor limpio de tu negocio.">
            ✅ Operación sana: no hay excepciones abiertas.
          </EmptyState>
        </Card>
      ) : (
        <>
          {/* Filtros: severidad + tipo. Sin selección = mostrar todo. */}
          {items.length > 0 && (
            <Card>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase text-navy/40">
                    Severidad
                  </span>
                  {SEVERITIES.map((s) => (
                    <button
                      key={s}
                      aria-pressed={sevFilter.has(s)}
                      onClick={() => setSevFilter((f) => toggle(f, s))}
                      className={chip(sevFilter.has(s))}
                    >
                      {SEVERITY_LABELS[s]}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase text-navy/40">
                    Tipo
                  </span>
                  {typesPresent.map((t) => (
                    <button
                      key={t}
                      aria-pressed={typeFilter.has(t)}
                      onClick={() => setTypeFilter((f) => toggle(f, t))}
                      className={chip(typeFilter.has(t))}
                    >
                      {TYPE_ICONS[t] ?? "⚠️"} {TYPE_LABELS[t] ?? t}
                    </button>
                  ))}
                  {(sevFilter.size > 0 || typeFilter.size > 0) && (
                    <button
                      onClick={() => {
                        setSevFilter(new Set());
                        setTypeFilter(new Set());
                      }}
                      className="text-xs font-medium text-navy/50 underline"
                    >
                      Limpiar
                    </button>
                  )}
                  <span className="ml-auto text-xs text-navy/40">
                    {filtered.length} de {items.length}
                  </span>
                </div>
              </div>
            </Card>
          )}

          {items.length > 0 &&
            (filtered.length === 0 ? (
              <Card>
                <EmptyState>Ninguna excepción coincide con los filtros.</EmptyState>
              </Card>
            ) : (
              <div className="space-y-2">
                {filtered.map((item) => (
                  <div
                    key={item.id}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-xl p-4 shadow-sm ${SEVERITY_STYLES[item.severity]}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 font-semibold">
                        <span aria-hidden="true">{TYPE_ICONS[item.type] ?? "⚠️"}</span>
                        <span>{item.title}</span>
                      </div>
                      <div className="mt-0.5 text-sm text-navy/70">{item.detail}</div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {item.action?.kind === "ACK_ALERT" && (
                        <Button onClick={() => runAction(item)} disabled={busyId === item.id}>
                          {busyId === item.id ? "…" : "Atender"}
                        </Button>
                      )}
                      {item.action?.kind === "FLAG_RECOVERY" && (
                        <Button onClick={() => runAction(item)} disabled={busyId === item.id}>
                          {busyId === item.id ? "…" : "Notificar comercio"}
                        </Button>
                      )}
                      {item.action?.kind === "OPEN_TRIAGE" && (
                        <Link
                          to="/direcciones"
                          className="rounded-lg bg-navy px-3 py-1.5 text-sm font-bold text-white"
                        >
                          Abrir triage
                        </Link>
                      )}
                      {item.action?.kind === "OPEN_ROUTE" && (
                        <Link
                          to="/rutas"
                          className="rounded-lg bg-navy px-3 py-1.5 text-sm font-bold text-white"
                        >
                          Ver ruta
                        </Link>
                      )}
                      {item.action?.kind === "OPEN_MAP" && (
                        <Link
                          to="/mapa"
                          className="rounded-lg bg-navy px-3 py-1.5 text-sm font-bold text-white"
                        >
                          Ver en mapa
                        </Link>
                      )}
                      {/* Posponer: oculta la excepción un rato sin resolverla. El
                          pánico no se pospone (siempre exige atención inmediata). */}
                      {item.type !== "PANIC" && (
                        <span className="flex items-center gap-1 text-xs text-navy/40">
                          Posponer
                          {SNOOZE_OPTIONS.map((o) => (
                            <button
                              key={o.minutes}
                              disabled={busyId === item.id}
                              onClick={() => snooze(item, o.minutes)}
                              className="rounded-md bg-niebla px-2 py-1 font-medium text-navy/70 hover:bg-cielo/40 disabled:opacity-50"
                            >
                              {o.label}
                            </button>
                          ))}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}

          {snoozed.length > 0 && (
            <Card title={`Pospuestas (${snoozed.length})`}>
              <div className="space-y-1">
                {snoozed.map((s) => (
                  <div
                    key={s.key}
                    className="flex items-center justify-between gap-3 text-sm text-navy/60"
                  >
                    <span className="truncate">
                      {KEY_PREFIX_LABELS[s.key.split("-")[0] ?? ""] ?? s.key} ·
                      vuelve {formatShortBogota(s.until)}
                    </span>
                    <button
                      onClick={() => unsnooze(s.key)}
                      className="shrink-0 text-xs font-medium text-navy underline"
                    >
                      Reactivar
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
