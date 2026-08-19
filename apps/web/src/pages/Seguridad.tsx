import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import {
  Ban,
  Bell,
  BellOff,
  Clock,
  Phone,
  RefreshCw,
  Route,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, ApiError } from "../api";
import { formatDateTimeBogota } from "../format";
import { useRealtimeReload } from "../realtime";
import {
  Button,
  Card,
  EmptyState,
  FilterPill,
  Loading,
  ModuleDisabled,
  PageHeader,
  StatusBadge,
} from "../components/ui";

interface Alert {
  id: string;
  type: string;
  details: string | null;
  status: string;
  lat: number | null;
  lng: number | null;
  createdAt: string;
}

type Severity = "CRITICAL" | "HIGH" | "MEDIUM";

const TYPE_LABELS: Record<string, string> = {
  PANIC: "Pánico",
  ROUTE_DEVIATION: "Desviación de ruta",
  LONG_STOP: "Parada prolongada",
  GEOFENCE_EXIT: "Salida de geocerca",
};
const TYPE_ICONS: Record<string, LucideIcon> = {
  PANIC: TriangleAlert,
  ROUTE_DEVIATION: Route,
  LONG_STOP: Clock,
  GEOFENCE_EXIT: Ban,
};
const SEVERITY_BY_TYPE: Record<string, Severity> = {
  PANIC: "CRITICAL",
  GEOFENCE_EXIT: "HIGH",
  ROUTE_DEVIATION: "HIGH",
  LONG_STOP: "MEDIUM",
};
function severityOf(type: string): Severity {
  return SEVERITY_BY_TYPE[type] ?? "MEDIUM";
}
const SEV_RANK: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
/** Hex solo para los divIcon de Leaflet (HTML en cadena, sin utilidades). */
const SEV_COLOR: Record<Severity, string> = {
  CRITICAL: "#CE2C32",
  HIGH: "#8a5a12",
  MEDIUM: "#3a5169",
};
const SEV_BORDER: Record<Severity, string> = {
  CRITICAL: "border-l-danger",
  HIGH: "border-l-warning",
  MEDIUM: "border-l-info",
};
const SEV_TEXT: Record<Severity, string> = {
  CRITICAL: "text-danger",
  HIGH: "text-warning",
  MEDIUM: "text-info",
};
const SEVERITIES: Severity[] = ["CRITICAL", "HIGH", "MEDIUM"];
const SEV_LABELS: Record<Severity, string> = {
  CRITICAL: "Críticas",
  HIGH: "Altas",
  MEDIUM: "Medias",
};
const STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED", "FALSE_ALARM"];
const STATUS_LABELS: Record<string, string> = {
  OPEN: "Abiertas",
  ACKNOWLEDGED: "Atendidas",
  RESOLVED: "Resueltas",
  FALSE_ALARM: "Falsas",
};
const DEPOT = { lat: 4.6486, lng: -74.0628 };

function dotIcon(color: string, selected: boolean) {
  const size = selected ? 22 : 16;
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:${selected ? 3 : 2}px solid #F2F5F3"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** Recentra el mapa sobre la alerta seleccionada. */
function FocusOnAlert({ target }: { target: { lat: number; lng: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.panTo([target.lat, target.lng], { animate: true });
  }, [target?.lat, target?.lng, map]);
  return null;
}

/** Tiempo relativo corto ("hace 2 min") para la cabecera de cada alerta. */
function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

/** Pitido con Web Audio (sin asset): patrón urgente para pánico. */
function beep(urgent: boolean) {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const tone = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    };
    tone(880, 0, 0.25);
    if (urgent) {
      tone(1175, 0.3, 0.25);
      tone(880, 0.6, 0.3);
    }
    setTimeout(() => void ctx.close(), 1500);
  } catch {
    // audio bloqueado por el navegador hasta una interacción: ignorar.
  }
}

export default function Seguridad() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [moduleOff, setModuleOff] = useState(false);
  const [error, setError] = useState(false);
  const [muted, setMuted] = useState(false);
  const [sevFilter, setSevFilter] = useState<Set<Severity>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Detección de alertas nuevas para el aviso sonoro (no suena en la 1ª carga).
  const knownIds = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  const mutedRef = useRef(false);
  mutedRef.current = muted;

  const load = useCallback(async () => {
    try {
      const data = await api<Alert[]>("GET", "/safety/alerts");
      setAlerts(data);
      setError(false);

      const fresh = data.filter(
        (a) => a.status === "OPEN" && !knownIds.current.has(a.id),
      );
      if (primed.current && fresh.length > 0 && !mutedRef.current) {
        beep(fresh.some((a) => a.type === "PANIC"));
      }
      knownIds.current = new Set(data.map((a) => a.id));
      primed.current = true;
    } catch (err) {
      if (err instanceof ApiError && err.code === "MODULE_NOT_ENABLED") {
        setModuleOff(true);
      } else {
        setError(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Tiempo real: pánico y desviaciones llegan por SSE al instante (antes:
  // sondeo cada 15 s). Queda un respaldo lento por si el stream se cae.
  useRealtimeReload(["safety"], () => void load());

  async function setStatus(id: string, status: string) {
    try {
      await api("PATCH", `/safety/alerts/${id}`, { status });
      await load();
    } catch {
      setError(true);
    }
  }

  function toggle<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  const visible = useMemo(() => {
    return alerts
      .filter(
        (a) =>
          (sevFilter.size === 0 || sevFilter.has(severityOf(a.type))) &&
          (statusFilter.size === 0 || statusFilter.has(a.status)),
      )
      .sort((a, b) => {
        // Abiertas primero, luego por severidad, luego recientes.
        const openA = a.status === "OPEN" ? 0 : 1;
        const openB = b.status === "OPEN" ? 0 : 1;
        return (
          openA - openB ||
          SEV_RANK[severityOf(a.type)] - SEV_RANK[severityOf(b.type)] ||
          b.createdAt.localeCompare(a.createdAt)
        );
      });
  }, [alerts, sevFilter, statusFilter]);

  const mapAlerts = visible.filter((a) => a.lat !== null && a.lng !== null);
  const selected = alerts.find((a) => a.id === selectedId) ?? null;
  const focusTarget =
    selected && selected.lat !== null && selected.lng !== null
      ? { lat: selected.lat, lng: selected.lng }
      : null;
  const openCount = alerts.filter((a) => a.status === "OPEN").length;

  if (moduleOff) {
    return <ModuleDisabled title="Seguridad de carga" moduleName="de seguridad" />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Seguridad de carga"
        subtitle="Pánico y desviaciones sobre la telemetría · central de monitoreo + PONAL en producción"
        actions={
          <>
            {openCount > 0 && (
              <span className="whitespace-nowrap rounded-full bg-danger-bg px-3 py-1 text-xs font-semibold text-danger">
                {openCount} abiertas
              </span>
            )}
            <button
              onClick={() => setMuted((m) => !m)}
              aria-pressed={muted}
              title={muted ? "Activar sonido" : "Silenciar"}
              className={`inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-xs font-medium transition duration-200 ease-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-asfalto ${
                muted ? "text-text-tertiary" : "text-asfalto"
              }`}
            >
              {muted ? (
                <BellOff aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
              ) : (
                <Bell aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
              )}
              {muted ? "Silenciado" : "Sonido activo"}
            </button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-text-tertiary">
          Severidad
        </span>
        {SEVERITIES.map((s) => (
          <FilterPill
            key={s}
            active={sevFilter.has(s)}
            onClick={() => setSevFilter((f) => toggle(f, s))}
          >
            {SEV_LABELS[s]}
          </FilterPill>
        ))}
        <span aria-hidden="true" className="mx-1 h-[18px] w-px bg-border" />
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-text-tertiary">
          Estado
        </span>
        {STATUSES.map((s) => (
          <FilterPill
            key={s}
            active={statusFilter.has(s)}
            onClick={() => setStatusFilter((f) => toggle(f, s))}
          >
            {STATUS_LABELS[s]}
          </FilterPill>
        ))}
        {(sevFilter.size > 0 || statusFilter.size > 0) && (
          <button
            onClick={() => {
              setSevFilter(new Set());
              setStatusFilter(new Set());
            }}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-text-tertiary transition duration-200 ease-brand hover:bg-canvas hover:text-asfalto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-asfalto"
          >
            <X aria-hidden="true" className="h-3 w-3" strokeWidth={2} />
            Limpiar
          </button>
        )}
      </div>

      {error && (
        <Card>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-danger">No se pudieron cargar las alertas.</span>
            <Button variant="secondary" icon={<RefreshCw />} onClick={() => void load()}>
              Reintentar
            </Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          {loading && <Loading label="Cargando alertas…" />}
          {!loading && alerts.length === 0 && (
            <EmptyState
              icon={<ShieldCheck aria-hidden="true" className="h-8 w-8" strokeWidth={1.75} />}
            >
              Sin alertas. Operación tranquila.
            </EmptyState>
          )}
          {!loading && alerts.length > 0 && visible.length === 0 && (
            <EmptyState>Ninguna alerta coincide con los filtros.</EmptyState>
          )}
          <div className="space-y-2">
            {visible.map((a) => {
              const sev = severityOf(a.type);
              const isSel = a.id === selectedId;
              const Icon = TYPE_ICONS[a.type] ?? TriangleAlert;
              const actionable = a.status === "OPEN" || a.status === "ACKNOWLEDGED";

              // Pánico abierto: alerta protagonista, expandida con sus 3
              // resoluciones jerarquizadas (Atender navy · Resolver · Falsa).
              if (a.type === "PANIC" && a.status === "OPEN") {
                return (
                  <div
                    key={a.id}
                    onClick={() => setSelectedId(a.id)}
                    className={`cursor-pointer rounded-xl border border-l-4 bg-danger-bg p-3.5 transition duration-200 ease-brand ${
                      isSel ? "border-danger" : "border-danger/40"
                    } border-l-danger`}
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full bg-danger text-white">
                        <Icon aria-hidden="true" className="h-[17px] w-[17px]" strokeWidth={2} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-[14.5px] font-bold text-asfalto">
                            {TYPE_LABELS[a.type] ?? a.type}
                          </span>
                          <span className="text-[11.5px] font-bold text-danger">
                            {timeAgo(a.createdAt)}
                          </span>
                        </div>
                        <div className="text-xs text-text-secondary">
                          {a.details}
                          {a.lat !== null && (
                            <>
                              {" · "}
                              <span className="font-mono">
                                ({a.lat.toFixed(4)}, {a.lng?.toFixed(4)})
                              </span>
                            </>
                          )}
                          {" · "}
                          <span className="font-mono">{formatDateTimeBogota(a.createdAt)}</span>
                        </div>
                      </div>
                      <StatusBadge status={a.status} />
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <Button
                        variant="primary"
                        icon={<Phone />}
                        onClick={() => void setStatus(a.id, "ACKNOWLEDGED")}
                      >
                        Atender — llamar al conductor
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => void setStatus(a.id, "RESOLVED")}
                      >
                        Resolver
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => void setStatus(a.id, "FALSE_ALARM")}
                      >
                        Falsa alarma
                      </Button>
                      {!muted && (
                        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-danger">
                          <span
                            aria-hidden="true"
                            className="h-[7px] w-[7px] animate-livepulse rounded-full bg-danger"
                          />
                          sonando en central
                        </span>
                      )}
                    </div>
                  </div>
                );
              }

              // Resto de alertas: fila compacta con icono de tipo y acciones fantasma.
              return (
                <div
                  key={a.id}
                  onClick={() => setSelectedId(a.id)}
                  className={`flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-l-4 bg-surface px-3.5 py-2.5 transition duration-200 ease-brand hover:-translate-y-[2px] hover:shadow-soft-lg ${
                    isSel ? "border-asfalto bg-info-bg/60" : "border-border"
                  } ${SEV_BORDER[sev]} ${actionable ? "" : "opacity-75"}`}
                >
                  <Icon
                    aria-hidden="true"
                    className={`h-4 w-4 flex-none ${SEV_TEXT[sev]}`}
                    strokeWidth={2}
                  />
                  <div className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-asfalto">
                      {TYPE_LABELS[a.type] ?? a.type}
                    </span>
                    <span className="block text-[11.5px] text-text-tertiary">
                      {a.details}
                      {a.lat !== null && (
                        <>
                          {" · "}
                          <span className="font-mono">
                            ({a.lat.toFixed(4)}, {a.lng?.toFixed(4)})
                          </span>
                        </>
                      )}
                      {" · "}
                      <span className="font-mono">{formatDateTimeBogota(a.createdAt)}</span>
                      {" · "}
                      {timeAgo(a.createdAt)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={a.status} />
                    {actionable && (
                      <>
                        {a.status === "OPEN" && (
                          <Button
                            variant="secondary"
                            className="px-2.5 py-1 text-xs"
                            onClick={() => void setStatus(a.id, "ACKNOWLEDGED")}
                          >
                            Atender
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          className="px-2.5 py-1 text-xs"
                          onClick={() => void setStatus(a.id, "RESOLVED")}
                        >
                          Resolver
                        </Button>
                        <Button
                          variant="secondary"
                          className="px-2.5 py-1 text-xs"
                          onClick={() => void setStatus(a.id, "FALSE_ALARM")}
                        >
                          Falsa alarma
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Mapa de alertas">
          {mapAlerts.length === 0 ? (
            <EmptyState>Ninguna alerta con ubicación para mostrar.</EmptyState>
          ) : (
            <div className="overflow-hidden rounded-lg">
              <MapContainer
                center={[focusTarget?.lat ?? DEPOT.lat, focusTarget?.lng ?? DEPOT.lng]}
                zoom={12}
                style={{ height: 360 }}
              >
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <FocusOnAlert target={focusTarget} />
                {mapAlerts.map((a) => {
                  const sev = severityOf(a.type);
                  return (
                    <Marker
                      key={a.id}
                      position={[a.lat!, a.lng!]}
                      icon={dotIcon(SEV_COLOR[sev], a.id === selectedId)}
                      eventHandlers={{ click: () => setSelectedId(a.id) }}
                    >
                      <Popup>
                        <strong>{TYPE_LABELS[a.type] ?? a.type}</strong>
                        <br />
                        {a.details}
                        <br />
                        {formatDateTimeBogota(a.createdAt)}
                      </Popup>
                    </Marker>
                  );
                })}
              </MapContainer>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
