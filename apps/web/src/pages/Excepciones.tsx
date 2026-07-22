import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  BatteryLow,
  Bell,
  ChevronDown,
  CircleCheck,
  Clock,
  FileText,
  Hourglass,
  MapPin,
  Package,
  Route,
  Signal,
  TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatShortBogota } from "@moveos/shared";
import { api } from "../api";
import { canOfferStaffPush, enableStaffPush } from "../push";
import { useRealtimeReload } from "../realtime";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  FilterPill,
  KpiCard,
  LivePill,
  Loading,
  PageHeader,
} from "../components/ui";

/**
 * Cockpit de excepciones: la pantalla de inicio operativa del día. Una sola
 * cola priorizada (pánico, desvíos, rutas tarde, vehículos mudos, batería
 * baja, entregas fallidas, direcciones sin confirmar) con acción de un clic,
 * filtros por severidad/tipo y "posponer" para aplazar lo no urgente.
 *
 * Revamp 1b: fila de KPI que filtra por severidad, íconos Lucide, cola
 * agrupada por severidad (el pánico nunca se mezcla), "Posponer" colapsado a
 * un menú e indicador "En vivo" alimentado por el SSE existente.
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

const SEVERITIES: Severity[] = ["CRITICAL", "HIGH", "MEDIUM"];
const SEVERITY_LABELS: Record<Severity, string> = {
  CRITICAL: "Críticas",
  HIGH: "Altas",
  MEDIUM: "Medias",
};

/** Cabecera de grupo: punto de 8px + rótulo 11px en el color de la familia. */
const GROUP_HEADER_STYLES: Record<Severity, { dot: string; text: string }> = {
  CRITICAL: { dot: "bg-danger", text: "text-danger" },
  HIGH: { dot: "bg-warning", text: "text-warning" },
  MEDIUM: { dot: "bg-cielo", text: "text-text-tertiary" },
};

/** Círculo de 36px del ícono, tintado por severidad (pánico: relleno sólido). */
const ICON_CIRCLE_STYLES: Record<Severity, string> = {
  CRITICAL: "bg-danger-bg text-danger",
  HIGH: "bg-warning-bg text-warning",
  MEDIUM: "bg-sky-50 text-info",
};

/** Borde izquierdo de 3px de la tarjeta según severidad. */
const CARD_LEFT_BORDER: Record<Severity, string> = {
  CRITICAL: "border-l-danger",
  HIGH: "border-l-warning",
  MEDIUM: "border-l-cielo",
};

const TYPE_ICONS: Record<string, LucideIcon> = {
  PANIC: TriangleAlert,
  ROUTE_DEVIATION: Route,
  ROUTE_LATE: Clock,
  VEHICLE_STALE: Signal,
  LOW_BATTERY: BatteryLow,
  FAILED_DELIVERY: Package,
  SLA_BREACH: Hourglass,
  ADDRESS_UNCONFIRMED: MapPin,
  DOC_EXPIRY: FileText,
};
const TYPE_LABELS: Record<string, string> = {
  PANIC: "Pánico",
  ROUTE_DEVIATION: "Desvío",
  ROUTE_LATE: "Ruta tarde",
  VEHICLE_STALE: "Sin señal",
  LOW_BATTERY: "Batería",
  FAILED_DELIVERY: "Fallidas",
  SLA_BREACH: "SLA",
  ADDRESS_UNCONFIRMED: "Direcciones",
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

// Presets de aplazo ofrecidos en el menú "Posponer" de cada tarjeta.
const SNOOZE_OPTIONS = [
  { minutes: 60, label: "1 h" },
  { minutes: 240, label: "4 h" },
  { minutes: 1440, label: "1 día" },
];

/** Enlace de acción con la misma apariencia del botón navy sólido. */
const navyLinkClass =
  "inline-flex items-center whitespace-nowrap rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white transition duration-200 ease-brand hover:bg-navy-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy";

/** Hora relativa en español ("hace 6 min"), como en la propuesta 1b. */
function relTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

/**
 * Menú "Posponer" colapsado (reloj + chevron): un solo botón fantasma por fila
 * que despliega los presets 1 h / 4 h / 1 día. Cierra con clic afuera o Escape.
 */
function SnoozeMenu({
  disabled,
  onSnooze,
}: {
  disabled?: boolean;
  onSnooze: (minutes: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-navy/25 bg-surface px-2.5 py-1.5 text-xs font-medium text-navy transition duration-200 ease-brand hover:bg-lima/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Clock aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
        Posponer
        <ChevronDown
          aria-hidden="true"
          className={`h-3 w-3 transition duration-200 ease-brand ${open ? "rotate-180" : ""}`}
          strokeWidth={2}
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-24 rounded-lg border border-border bg-surface py-1 shadow-soft-lg"
        >
          {SNOOZE_OPTIONS.map((o) => (
            <button
              key={o.minutes}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSnooze(o.minutes);
              }}
              className="block w-full px-3 py-1.5 text-left text-xs font-medium text-navy transition hover:bg-niebla"
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Excepciones() {
  const [items, setItems] = useState<ExceptionItem[] | null>(null);
  const [snoozed, setSnoozed] = useState<Snoozed[]>([]);
  const [banner, setBanner] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pushOffer, setPushOffer] = useState(canOfferStaffPush());
  const [sevFilter, setSevFilter] = useState<Set<Severity>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  // Solo UI: cuándo llegó el último dato (para "actualizado hace N s") y un
  // tic cada 5 s que refresca las horas relativas sin tocar la red.
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: ExceptionItem[]; snoozed: Snoozed[] }>(
        "GET",
        "/exceptions",
      );
      setItems(res.items);
      setSnoozed(res.snoozed);
      setLastUpdated(Date.now());
    } catch {
      // el sondeo de respaldo reintenta
    }
  }, []);

  useRealtimeReload(["order", "safety", "telemetry"], load, { fallbackMs: 30_000 });

  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), 5_000);
    return () => clearInterval(timer);
  }, []);

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
  const counts = useMemo(() => {
    const c: Record<Severity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0 };
    for (const i of items ?? []) c[i.severity] += 1;
    return c;
  }, [items]);

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

  // "En vivo · actualizado hace N s" — el tic de 5 s mantiene el número fresco.
  const secondsAgo =
    lastUpdated === null ? null : Math.max(0, Math.round((Date.now() - lastUpdated) / 1000));
  const liveText =
    secondsAgo === null
      ? "En vivo"
      : `En vivo · actualizado hace ${
          secondsAgo < 60 ? `${secondsAgo} s` : `${Math.round(secondsAgo / 60)} min`
        }`;

  // Pistas de los KPI, derivadas de los datos reales de la cola.
  const heroHint =
    counts.CRITICAL === 0
      ? "sin acciones inmediatas pendientes"
      : counts.CRITICAL === 1
        ? "1 exige acción inmediata"
        : `${counts.CRITICAL} exigen acción inmediata`;
  const sevHint = (sev: Severity): string => {
    const labels = [
      ...new Set(
        items
          .filter((i) => i.severity === sev)
          .map((i) => (TYPE_LABELS[i.type] ?? i.type).toLowerCase()),
      ),
    ];
    return labels.length === 0 ? "ninguna abierta" : labels.slice(0, 3).join(" · ");
  };
  const snoozeHint =
    snoozed.length === 0
      ? "sin aplazos activos"
      : `vuelve${snoozed.length > 1 ? "n" : ""} ${snoozed
          .slice(0, 2)
          .map((s) => formatShortBogota(s.until))
          .join(" y ")}${snoozed.length > 2 ? "…" : ""}`;

  const groups = SEVERITIES.map((sev) => ({
    sev,
    rows: filtered.filter((i) => i.severity === sev),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Excepciones"
        subtitle="Todo lo que requiere tu acción ahora, en una sola cola priorizada."
        actions={<LivePill>{liveText}</LivePill>}
      />
      {banner && (
        <Banner kind={banner.kind} onDismiss={() => setBanner(null)}>
          {banner.text}
        </Banner>
      )}

      {/* P0.6: sin esta suscripción, el push de pánico no tiene a quién llegar. */}
      {pushOffer && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-sky bg-sky-50 px-4 py-3">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-surface text-info"
          >
            <Bell className="h-4 w-4" strokeWidth={2} />
          </span>
          <p className="min-w-0 flex-1 text-sm text-navy">
            Recibe el botón de pánico y alertas críticas aunque el dashboard esté
            cerrado.
          </p>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              icon={<Bell strokeWidth={2} />}
              onClick={async () => {
                const ok = await enableStaffPush();
                setPushOffer(false);
                setBanner(
                  ok
                    ? { kind: "success", text: "Avisos activados en este dispositivo." }
                    : { kind: "error", text: "No se pudieron activar los avisos." },
                );
              }}
            >
              Activar avisos
            </Button>
            <Button variant="secondary" onClick={() => setPushOffer(false)}>
              Ahora no
            </Button>
          </div>
        </div>
      )}

      {items.length === 0 && snoozed.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CircleCheck className="h-9 w-9" strokeWidth={1.75} />}
            phrase="El motor limpio de tu negocio."
          >
            Operación sana: no hay excepciones abiertas.
          </EmptyState>
        </Card>
      ) : (
        <>
          {/* KPI del día: las tarjetas actúan de filtro por severidad. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Excepciones abiertas"
              value={items.length}
              hint={heroHint}
              tone="hero"
              onClick={() => setSevFilter(new Set())}
            />
            <KpiCard
              label="Críticas"
              value={
                sevFilter.has("CRITICAL") ? (
                  counts.CRITICAL
                ) : (
                  <span className="text-danger">{counts.CRITICAL}</span>
                )
              }
              hint={sevHint("CRITICAL")}
              active={sevFilter.has("CRITICAL")}
              onClick={() => setSevFilter((f) => toggle(f, "CRITICAL"))}
            />
            <KpiCard
              label="Altas"
              value={
                sevFilter.has("HIGH") ? (
                  counts.HIGH
                ) : (
                  <span className="text-warning">{counts.HIGH}</span>
                )
              }
              hint={sevHint("HIGH")}
              active={sevFilter.has("HIGH")}
              onClick={() => setSevFilter((f) => toggle(f, "HIGH"))}
            />
            <KpiCard label="Pospuestas" value={snoozed.length} hint={snoozeHint} />
          </div>

          {/* Filtros por tipo: una sola fila de pastillas + contador. */}
          {items.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[.04em] text-navy/40">
                Filtrar
              </span>
              <FilterPill
                active={typeFilter.size === 0}
                onClick={() => setTypeFilter(new Set())}
              >
                Todas
              </FilterPill>
              {typesPresent.map((t) => (
                <FilterPill
                  key={t}
                  active={typeFilter.has(t)}
                  onClick={() => setTypeFilter((f) => toggle(f, t))}
                >
                  {TYPE_LABELS[t] ?? t}
                </FilterPill>
              ))}
              <span className="ml-auto text-xs text-navy/40">
                {filtered.length} de {items.length}
              </span>
            </div>
          )}

          {items.length > 0 &&
            (filtered.length === 0 ? (
              <Card>
                <EmptyState>Ninguna excepción coincide con los filtros.</EmptyState>
              </Card>
            ) : (
              <div className="space-y-2">
                {groups.map((group, gi) => {
                  const header = GROUP_HEADER_STYLES[group.sev];
                  return (
                    <div key={group.sev} className={`space-y-2 ${gi > 0 ? "pt-2" : ""}`}>
                      {/* El encabezado de grupo también filtra por severidad —
                          es la única vía para aislar las Medias sin sumar una
                          quinta tarjeta KPI que el mock no tiene. */}
                      <button
                        type="button"
                        aria-pressed={sevFilter.has(group.sev)}
                        onClick={() => setSevFilter((f) => toggle(f, group.sev))}
                        title={`Filtrar ${SEVERITY_LABELS[group.sev].toLowerCase()}`}
                        className={`flex items-center gap-2 rounded-md text-[11px] font-semibold uppercase tracking-[.06em] transition duration-200 ease-brand hover:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${header.text}`}
                      >
                        <span
                          aria-hidden="true"
                          className={`h-2 w-2 rounded-full ${header.dot}`}
                        />
                        {SEVERITY_LABELS[group.sev]} · {group.rows.length}
                      </button>
                      {group.rows.map((item) => {
                        const panic = item.type === "PANIC";
                        const Icon = TYPE_ICONS[item.type] ?? TriangleAlert;
                        const cardClass = panic
                          ? "border border-danger/35 border-l-[3px] border-l-danger bg-danger-bg"
                          : `border border-border border-l-[3px] ${CARD_LEFT_BORDER[item.severity]} bg-surface`;
                        const circleClass = panic
                          ? "bg-danger text-white"
                          : ICON_CIRCLE_STYLES[item.severity];
                        return (
                          <div
                            key={item.id}
                            className={`flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-xl px-4 py-3.5 shadow-soft ${cardClass}`}
                          >
                            <span
                              aria-hidden="true"
                              className={`flex h-9 w-9 flex-none items-center justify-center rounded-full ${circleClass}`}
                            >
                              <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline gap-2">
                                <span className="text-sm font-semibold text-navy">
                                  {item.title}
                                </span>
                                <span
                                  className={`text-xs ${
                                    panic
                                      ? "font-semibold text-danger"
                                      : "text-text-tertiary"
                                  }`}
                                >
                                  {relTime(item.createdAt)}
                                </span>
                              </div>
                              <div className="mt-0.5 text-[13px] text-text-secondary">
                                {item.detail}
                              </div>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center gap-2">
                              {item.action?.kind === "ACK_ALERT" &&
                                (panic ? (
                                  // La ÚNICA excepción a la jerarquía de botones:
                                  // el pánico se atiende con rojo pleno.
                                  <Button
                                    variant="danger"
                                    className="font-semibold"
                                    onClick={() => runAction(item)}
                                    disabled={busyId === item.id}
                                  >
                                    {busyId === item.id ? "…" : "Atender ahora"}
                                  </Button>
                                ) : (
                                  <Button
                                    onClick={() => runAction(item)}
                                    disabled={busyId === item.id}
                                  >
                                    {busyId === item.id ? "…" : "Atender"}
                                  </Button>
                                ))}
                              {item.action?.kind === "FLAG_RECOVERY" && (
                                <Button
                                  onClick={() => runAction(item)}
                                  disabled={busyId === item.id}
                                >
                                  {busyId === item.id ? "…" : "Notificar comercio"}
                                </Button>
                              )}
                              {item.action?.kind === "OPEN_TRIAGE" && (
                                <Link to="/direcciones" className={navyLinkClass}>
                                  Abrir triage
                                </Link>
                              )}
                              {item.action?.kind === "OPEN_ROUTE" && (
                                <Link to="/rutas" className={navyLinkClass}>
                                  Ver ruta
                                </Link>
                              )}
                              {item.action?.kind === "OPEN_MAP" && (
                                <Link to="/mapa" className={navyLinkClass}>
                                  Ver en mapa
                                </Link>
                              )}
                              {/* Posponer: oculta la excepción un rato sin resolverla. El
                                  pánico no se pospone (siempre exige atención inmediata). */}
                              {!panic && (
                                <SnoozeMenu
                                  disabled={busyId === item.id}
                                  onSnooze={(minutes) => snooze(item, minutes)}
                                />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}

          {snoozed.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border border-dashed border-border-strong px-4 py-2.5 text-[13px] text-text-secondary">
              <Clock aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
              <span className="font-semibold text-navy">
                Pospuestas ({snoozed.length}):
              </span>
              {snoozed.map((s, i) => (
                <Fragment key={s.key}>
                  {i > 0 && (
                    <span aria-hidden="true" className="text-border-strong">
                      |
                    </span>
                  )}
                  <span>
                    {KEY_PREFIX_LABELS[s.key.split("-")[0] ?? ""] ?? s.key} · vuelve{" "}
                    {formatShortBogota(s.until)}
                  </span>
                  <button
                    onClick={() => unsnooze(s.key)}
                    className="text-xs font-medium text-navy underline transition hover:text-navy-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                  >
                    Reactivar
                  </button>
                </Fragment>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
