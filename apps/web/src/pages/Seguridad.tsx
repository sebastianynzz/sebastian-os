import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { api, ApiError } from "../api";
import { formatDateTimeBogota } from "../format";
import { useRealtimeReload } from "../realtime";
import {
  Button,
  Card,
  EmptyState,
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
  PANIC: "🚨 Pánico",
  ROUTE_DEVIATION: "↪ Desviación de ruta",
  LONG_STOP: "⏱ Parada prolongada",
  GEOFENCE_EXIT: "⛔ Salida de geocerca",
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
const SEV_COLOR: Record<Severity, string> = {
  CRITICAL: "#dc2626",
  HIGH: "#f59e0b",
  MEDIUM: "#0ea5e9",
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
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:${selected ? 3 : 2}px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.3)"></div>`,
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

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition ${
      active ? "bg-navy text-white" : "bg-niebla text-navy/70 hover:bg-cielo/40"
    }`;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Seguridad de carga"
        subtitle="Alertas de pánico y desviaciones de ruta (detección automática sobre la
          telemetría). En producción se integra con central de monitoreo y PONAL."
        actions={
          <div className="flex items-center gap-2">
            {openCount > 0 && (
              <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                {openCount} abiertas
              </span>
            )}
            <button
              onClick={() => setMuted((m) => !m)}
              aria-pressed={muted}
              title={muted ? "Activar sonido" : "Silenciar"}
              className="rounded-lg border border-cielo bg-white px-3 py-1.5 text-sm"
            >
              {muted ? "🔕 Silenciado" : "🔔 Sonido"}
            </button>
          </div>
        }
      />

      <Card>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase text-navy/40">Severidad</span>
            {SEVERITIES.map((s) => (
              <button
                key={s}
                aria-pressed={sevFilter.has(s)}
                onClick={() => setSevFilter((f) => toggle(f, s))}
                className={chip(sevFilter.has(s))}
              >
                {SEV_LABELS[s]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase text-navy/40">Estado</span>
            {STATUSES.map((s) => (
              <button
                key={s}
                aria-pressed={statusFilter.has(s)}
                onClick={() => setStatusFilter((f) => toggle(f, s))}
                className={chip(statusFilter.has(s))}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
            {(sevFilter.size > 0 || statusFilter.size > 0) && (
              <button
                onClick={() => {
                  setSevFilter(new Set());
                  setStatusFilter(new Set());
                }}
                className="text-xs font-medium text-navy/50 underline"
              >
                Limpiar
              </button>
            )}
          </div>
        </div>
      </Card>

      {error && (
        <Card>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-red-700">No se pudieron cargar las alertas.</span>
            <Button variant="secondary" onClick={() => void load()}>
              Reintentar
            </Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          {loading && <Loading label="Cargando alertas…" />}
          {!loading && alerts.length === 0 && (
            <EmptyState>Sin alertas. Operación tranquila ✓</EmptyState>
          )}
          {!loading && alerts.length > 0 && visible.length === 0 && (
            <EmptyState>Ninguna alerta coincide con los filtros.</EmptyState>
          )}
          <div className="space-y-2">
            {visible.map((a) => {
              const sev = severityOf(a.type);
              const isSel = a.id === selectedId;
              return (
                <div
                  key={a.id}
                  onClick={() => setSelectedId(a.id)}
                  className={`cursor-pointer rounded-lg border p-3 ${
                    isSel ? "border-navy bg-cielo/20" : "border-niebla"
                  }`}
                  style={{ borderLeft: `4px solid ${SEV_COLOR[sev]}` }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">{TYPE_LABELS[a.type] ?? a.type}</div>
                      <div className="text-xs text-navy/50">
                        {a.details}
                        {a.lat !== null && ` · (${a.lat.toFixed(4)}, ${a.lng?.toFixed(4)})`}
                        {" · "}
                        {formatDateTimeBogota(a.createdAt)}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={a.status} />
                      {(a.status === "OPEN" || a.status === "ACKNOWLEDGED") && (
                        <>
                          {a.status === "OPEN" && (
                            <Button
                              variant="secondary"
                              onClick={() => void setStatus(a.id, "ACKNOWLEDGED")}
                            >
                              Atender
                            </Button>
                          )}
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
                        </>
                      )}
                    </div>
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
