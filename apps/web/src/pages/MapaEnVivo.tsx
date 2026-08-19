import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { BatteryCharging, Gauge, Lock, MapPin, Navigation, Power, Route } from "lucide-react";
import { api, ApiError } from "../api";
import { useRealtimeReload } from "../realtime";
import { formatNumber } from "../format";
import { Badge, Button, EmptyState, LivePill, ModuleDisabled, PageHeader } from "../components/ui";

const DEPOT = { lat: 4.6486, lng: -74.0628 };

/** Saneo mínimo para interpolar texto en el HTML de los divIcon de Leaflet. */
function esc(s: string) {
  return s.replace(/[<>&"']/g, "");
}

/**
 * Marcador de vehículo: punto de color según estado del sistema (verde =
 * encendido, rojo = apagado/inmovilizado) + chip de etiqueta "PLACA · N km/h"
 * en navy. Colores vía tokens CSS de :root (styles.css), no hex sueltos.
 */
function vehicleIcon(plate: string, speedKmh: number, engineOn: boolean) {
  const color = engineOn ? "var(--success)" : "var(--danger)";
  return L.divIcon({
    className: "",
    html:
      `<div style="position:relative;width:14px;height:14px">` +
      `<div style="width:14px;height:14px;border-radius:999px;background:${color};border:2px solid #F2F5F3"></div>` +
      `<div style="position:absolute;left:20px;top:-3px;background:var(--navy);color:#fff;border-radius:6px;padding:2px 7px;font-size:11px;font-weight:600;font-family:ui-monospace,Menlo,monospace;white-space:nowrap">${esc(plate)} · ${Math.round(speedKmh)} km/h</div>` +
      `</div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

/** Depósito: cuadrado navy con borde blanco (leyenda "Depósito"). */
const depotIcon = L.divIcon({
  className: "",
  html: `<div style="width:16px;height:16px;background:var(--navy);border:3px solid #F2F5F3"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

/**
 * Restyle del plugin de clusters vía su propia opción `iconCreateFunction`
 * (no se pelea con el plugin): círculo limón con el conteo en navy.
 */
function clusterIcon(cluster: L.MarkerCluster) {
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:999px;background:rgba(0,229,113,.85);border:2px solid #F2F5F3;font-size:12px;font-weight:700;color:var(--navy)">${cluster.getChildCount()}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

interface LiveEntry {
  vehicle: {
    id: string;
    plate: string;
    type: string;
    isElectric: boolean;
    engineOn: boolean;
    immobilized: boolean;
    lastSpeedKmh: number | null;
    socPercent: number | null;
    lastSeenAt: string | null;
  };
  ping: {
    lat: number;
    lng: number;
    speedKmh: number | null;
    rpm: number | null;
    fuelLevelPct: number | null;
    coolantTempC: number | null;
    odometerKm: number | null;
    recordedAt: string;
  } | null;
}

interface Command {
  id: string;
  type: string;
  status: string;
  reason: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

/** Estados del comando (PENDING | SENT | ACK | REJECTED) con color semántico. */
const CMD_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "PENDIENTE", cls: "text-warning" },
  SENT: { label: "ENVIADO", cls: "text-info" },
  ACK: { label: "CONFIRMADO", cls: "text-lime-ink" },
  REJECTED: { label: "RECHAZADO", cls: "text-danger" },
};

function FitToVehicles({ entries }: { entries: LiveEntry[] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current) return;
    const pts = entries.filter((e) => e.ping).map((e) => [e.ping!.lat, e.ping!.lng] as [number, number]);
    if (pts.length > 0) {
      map.fitBounds(L.latLngBounds([...pts, [DEPOT.lat, DEPOT.lng]]).pad(0.2));
      fitted.current = true;
    }
  }, [entries, map]);
  return null;
}

/**
 * Seguir un vehículo: cuando está activo, recentra el mapa sobre el vehículo
 * seleccionado en cada actualización de posición. Si el despachador arrastra el
 * mapa, deja de seguir para no pelear su gesto (panTo programático no dispara
 * `dragstart`, así que solo reacciona al arrastre real del usuario).
 */
function FollowVehicle({
  target,
  follow,
  onUserPan,
}: {
  target: { lat: number; lng: number } | null;
  follow: boolean;
  onUserPan: () => void;
}) {
  const map = useMap();
  useEffect(() => {
    if (follow && target) map.panTo([target.lat, target.lng], { animate: true });
  }, [follow, target?.lat, target?.lng, map]);
  useEffect(() => {
    if (!follow) return;
    map.on("dragstart", onUserPan);
    return () => {
      map.off("dragstart", onUserPan);
    };
  }, [follow, map, onUserPan]);
  return null;
}

/** "hace N s" — frescura del último ping, con tic local de 1 s. */
function Freshness({ ts }: { ts: string | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!ts) return null;
  const secs = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  const label =
    secs < 60
      ? `hace ${secs} s`
      : secs < 3600
        ? `hace ${Math.floor(secs / 60)} min`
        : `hace ${Math.floor(secs / 3600)} h`;
  return <span className="ml-auto whitespace-nowrap text-[11px] text-text-tertiary">{label}</span>;
}

/** Mini barra de SoC: relleno limón; ámbar (warning) por debajo del 30 %. */
function SocBar({ pct, track, className = "" }: { pct: number; track: string; className?: string }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <span aria-hidden="true" className={`block h-[5px] overflow-hidden rounded-full ${track} ${className}`}>
      <span
        className={`block h-full ${clamped < 30 ? "bg-warning" : "bg-lima"}`}
        style={{ width: `${clamped}%` }}
      />
    </span>
  );
}

/** Tile de telemetría 2×2: etiqueta 11px + cifra 19px con unidad atenuada. */
function TelemetryTile({
  icon,
  label,
  value,
  unit,
  valueCls = "text-navy",
  children,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  unit: string;
  valueCls?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <div className="flex items-center gap-1 text-[11px] text-text-tertiary">
        <span aria-hidden="true" className="[&>svg]:h-3 [&>svg]:w-3">
          {icon}
        </span>
        {label}
      </div>
      <div className={`mt-0.5 text-[19px] font-semibold leading-tight ${valueCls}`}>
        {value} <span className="text-xs font-medium text-text-tertiary">{unit}</span>
      </div>
      {children}
    </div>
  );
}

export default function MapaEnVivo() {
  const [entries, setEntries] = useState<LiveEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [commands, setCommands] = useState<Command[]>([]);
  const [moduleOff, setModuleOff] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "danger" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [follow, setFollow] = useState(false);
  const stopFollow = useCallback(() => setFollow(false), []);

  async function load() {
    try {
      setEntries(await api<LiveEntry[]>("GET", "/telematics/vehicles/live"));
    } catch (err) {
      if (err instanceof ApiError && err.code === "MODULE_NOT_ENABLED") {
        setModuleOff(true);
      }
    }
  }

  // Tiempo real: cada ping de telemetría empuja un evento SSE (antes: sondeo
  // cada 3 s). Regulado a 1.5 s para flotas que reportan en ráfaga.
  useRealtimeReload(["telemetry"], () => void load(), { throttleMs: 1500 });

  const selectedEntry = useMemo(
    () => entries.find((e) => e.vehicle.id === selected) ?? null,
    [entries, selected],
  );
  const followTarget = selectedEntry?.ping
    ? { lat: selectedEntry.ping.lat, lng: selectedEntry.ping.lng }
    : null;

  async function loadCommands(vehicleId: string) {
    setCommands(
      await api<Command[]>("GET", `/telematics/vehicles/${vehicleId}/commands`),
    );
  }

  async function selectVehicle(id: string) {
    setSelected(id);
    setMessage(null);
    await loadCommands(id);
  }

  async function sendCommand(type: "ENGINE_OFF" | "ENGINE_ON") {
    if (!selectedEntry) return;
    setBusy(true);
    setMessage(null);
    try {
      await api("POST", `/telematics/vehicles/${selectedEntry.vehicle.id}/commands`, {
        type,
        reason: type === "ENGINE_OFF" ? "Inmovilización desde central" : "Reactivación",
      });
      setMessage({
        text:
          type === "ENGINE_OFF"
            ? "Comando de apagado enviado. El dispositivo lo confirmará."
            : "Comando de encendido enviado.",
        tone: "info",
      });
      await loadCommands(selectedEntry.vehicle.id);
    } catch (err) {
      if (err instanceof ApiError && err.code === "VEHICLE_IN_MOTION") {
        setMessage({ text: err.message, tone: "danger" });
      } else {
        setMessage({ text: err instanceof Error ? err.message : "Error", tone: "danger" });
      }
    } finally {
      setBusy(false);
    }
  }

  if (moduleOff) {
    return <ModuleDisabled title="Mapa en vivo" moduleName="Telemática" />;
  }

  const reporting = entries.filter((e) => e.ping).length;
  const moving = selectedEntry && (selectedEntry.vehicle.lastSpeedKmh ?? 0) > 0.5;
  const selectedSpeed = Math.round(
    selectedEntry?.ping?.speedKmh ?? selectedEntry?.vehicle.lastSpeedKmh ?? 0,
  );

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="Mapa en vivo"
        actions={<LivePill>{reporting} vehículos reportando · SSE en tiempo real</LivePill>}
      />

      <div className="grid grid-cols-1 items-stretch gap-3.5 lg:grid-cols-[1fr_340px]">
        {/* ---- Mapa protagonista (toda la altura) ---- */}
        <div className="relative min-h-[600px] overflow-hidden rounded-lg border border-border shadow-soft">
          <MapContainer
            center={[DEPOT.lat, DEPOT.lng]}
            zoom={12}
            className="absolute inset-0 z-0 h-full w-full"
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <FitToVehicles entries={entries} />
            <FollowVehicle target={followTarget} follow={follow} onUserPan={stopFollow} />
            <Marker position={[DEPOT.lat, DEPOT.lng]} icon={depotIcon}>
              <Popup>Depósito</Popup>
            </Marker>
            {/* Agrupar vehículos cercanos en burbujas con conteo; se separan
                al hacer zoom o clic. chunkedLoading evita trabar el hilo con
                flotas grandes. El depósito queda fuera (marcador único). */}
            <MarkerClusterGroup chunkedLoading iconCreateFunction={clusterIcon}>
              {entries
                .filter((e) => e.ping)
                .map((e) => (
                  <Marker
                    key={e.vehicle.id}
                    position={[e.ping!.lat, e.ping!.lng]}
                    icon={vehicleIcon(
                      e.vehicle.plate,
                      e.ping!.speedKmh ?? e.vehicle.lastSpeedKmh ?? 0,
                      e.vehicle.engineOn,
                    )}
                    eventHandlers={{ click: () => selectVehicle(e.vehicle.id) }}
                  >
                    <Popup>
                      <strong>{e.vehicle.plate}</strong> · {e.vehicle.type}
                      <br />
                      {e.vehicle.engineOn ? "Encendido" : "Apagado"}
                      <br />
                      {(e.ping!.speedKmh ?? 0).toFixed(0)} km/h
                    </Popup>
                  </Marker>
                ))}
            </MarkerClusterGroup>
          </MapContainer>

          {/* Leyenda flotante (abajo-izquierda) */}
          <div className="pointer-events-none absolute bottom-3.5 left-3.5 z-[1000] flex flex-col gap-1.5 rounded-lg border border-border bg-surface px-3 py-2.5 text-xs text-text-secondary shadow-soft">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-success" />
              Sistema encendido
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-danger" />
              Apagado / inmovilizado
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 border-2 border-white bg-navy shadow-[0_0_0_1px_rgba(0,0,0,.2)]"
              />
              Depósito
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-lima/85 text-[9px] font-bold text-navy"
              >
                n
              </span>
              Grupo — clic para separar
            </span>
          </div>
        </div>

        {/* ---- Riel derecho: lista de vehículos + panel del seleccionado ---- */}
        <div className="flex min-h-[600px] flex-col gap-3">
          <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-3 shadow-soft">
            <div className="flex items-center justify-between px-1">
              <span className="text-[13px] font-semibold text-navy">Vehículos</span>
              <span className="text-[11px] text-text-tertiary">
                {reporting} de {entries.length} reportando
              </span>
            </div>
            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {entries.length === 0 && (
                <p className="px-1 py-2 text-sm text-text-tertiary">
                  Sin vehículos reportando todavía.
                </p>
              )}
              {entries.map((e) => {
                const isSel = selected === e.vehicle.id;
                const soc = e.vehicle.socPercent;
                return (
                  <button
                    key={e.vehicle.id}
                    onClick={() => selectVehicle(e.vehicle.id)}
                    aria-pressed={isSel}
                    className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition duration-200 ease-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy ${
                      isSel ? "border-sky bg-sky-50" : "border-transparent hover:bg-niebla"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        e.vehicle.engineOn ? "bg-success" : "bg-danger"
                      }`}
                    />
                    <span className="font-mono text-[13px] font-bold text-navy">
                      {e.vehicle.plate}
                    </span>
                    <span className="truncate text-[11px] text-text-secondary">
                      {e.vehicle.type} · {(e.vehicle.lastSpeedKmh ?? 0).toFixed(0)} km/h
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-1.5">
                      {e.vehicle.immobilized ? (
                        <Lock
                          aria-label="Inmovilizado"
                          className="h-3 w-3 text-danger"
                          strokeWidth={2}
                        />
                      ) : soc != null ? (
                        <SocBar
                          pct={soc}
                          track={isSel ? "bg-surface" : "bg-niebla"}
                          className="w-[54px]"
                        />
                      ) : null}
                      <span
                        className={`text-[11px] font-semibold ${
                          soc != null && soc < 30 && !e.vehicle.immobilized
                            ? "text-warning"
                            : "text-navy"
                        }`}
                      >
                        {soc != null ? `${soc.toFixed(0)}%` : "—"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {selectedEntry ? (
            <div className="flex flex-1 flex-col gap-2.5 rounded-lg border border-border bg-surface p-3.5 shadow-soft">
              {/* Cabecera: placa + tipo + estado + frescura del ping */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[15px] font-bold text-navy">
                  {selectedEntry.vehicle.plate}
                </span>
                <Badge tone="info">{selectedEntry.vehicle.type}</Badge>
                {selectedEntry.vehicle.engineOn ? (
                  <Badge tone="success">Encendido</Badge>
                ) : selectedEntry.vehicle.immobilized ? (
                  <Badge tone="danger">Inmovilizado</Badge>
                ) : (
                  <Badge tone="neutral">Apagado</Badge>
                )}
                <Freshness
                  ts={selectedEntry.ping?.recordedAt ?? selectedEntry.vehicle.lastSeenAt}
                />
              </div>

              {/* Seguir en el mapa: recentra sobre este vehículo en vivo. Se
                  desactiva solo si el despachador arrastra el mapa. */}
              <button
                onClick={() => setFollow((f) => !f)}
                aria-pressed={follow}
                disabled={!followTarget}
                className={`inline-flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-[13px] font-semibold transition duration-200 ease-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-50 ${
                  follow ? "bg-navy text-white" : "bg-niebla text-navy hover:bg-sky-50"
                }`}
              >
                <MapPin aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                {follow ? "Siguiendo en el mapa — arrastra para soltar" : "Seguir en el mapa"}
              </button>

              {/* Telemetría EV-only (Constraint 1): SoC, autonomía y energía —
                  nunca RPM / combustible / temp. de refrigerante. La flota
                  MoveOS es 100 % eléctrica; esos campos CAN ICE no se muestran. */}
              <div className="grid grid-cols-2 gap-2">
                <TelemetryTile
                  icon={<Gauge strokeWidth={1.75} />}
                  label="Velocidad"
                  value={String(selectedSpeed)}
                  unit="km/h"
                />
                <TelemetryTile
                  icon={<BatteryCharging strokeWidth={1.75} />}
                  label="Carga (SoC)"
                  value={selectedEntry.vehicle.socPercent?.toFixed(0) ?? "—"}
                  unit="%"
                  valueCls="text-lime-ink"
                >
                  {selectedEntry.vehicle.socPercent != null && (
                    <SocBar
                      pct={selectedEntry.vehicle.socPercent}
                      track="bg-niebla"
                      className="mt-1 w-full"
                    />
                  )}
                </TelemetryTile>
                <TelemetryTile
                  icon={<Route strokeWidth={1.75} />}
                  label="Autonomía útil"
                  value="—"
                  unit="km"
                />
                <TelemetryTile
                  icon={<Navigation strokeWidth={1.75} />}
                  label="Odómetro"
                  value={
                    selectedEntry.ping?.odometerKm != null
                      ? formatNumber(Math.round(selectedEntry.ping.odometerKm))
                      : "—"
                  }
                  unit="km"
                />
              </div>

              {/* Zona de peligro: inmovilización anti-robo con fricción — solo
                  con el vehículo detenido y confirmación del dispositivo. */}
              <div className="mt-auto flex flex-col gap-2 rounded-lg border border-danger/30 bg-danger-bg p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[.05em] text-danger">
                  <Lock aria-hidden="true" className="h-[13px] w-[13px]" strokeWidth={2} />
                  Inmovilización anti-robo
                </div>
                {selectedEntry.vehicle.engineOn ? (
                  <>
                    <button
                      onClick={() => sendCommand("ENGINE_OFF")}
                      disabled={busy || !!moving}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-danger bg-surface px-3 py-[7px] text-[13px] font-semibold text-danger transition duration-200 ease-brand hover:bg-danger hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-surface disabled:hover:text-danger"
                    >
                      <Power aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                      Apagar motor
                    </button>
                    <span className="text-[11.5px] leading-relaxed text-danger">
                      {moving
                        ? `En movimiento (${selectedSpeed} km/h): solo se puede apagar con el vehículo detenido. El dispositivo confirmará el comando.`
                        : "Solo con el vehículo detenido. El dispositivo confirmará el comando."}
                    </span>
                  </>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => sendCommand("ENGINE_ON")}
                      icon={<Power strokeWidth={2} />}
                    >
                      Reactivar motor
                    </Button>
                    <span className="text-[11.5px] leading-relaxed text-danger">
                      El dispositivo confirmará el comando.
                    </span>
                  </>
                )}
                {message && (
                  <p
                    className={`text-xs ${
                      message.tone === "danger" ? "text-danger" : "text-text-secondary"
                    }`}
                  >
                    {message.text}
                  </p>
                )}
              </div>

              {commands.length > 0 && (
                <div className="border-t border-border pt-2">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-[.05em] text-text-tertiary">
                    Historial de comandos
                  </div>
                  <ul className="space-y-0.5">
                    {commands.slice(0, 5).map((c) => {
                      const st = CMD_STATUS[c.status] ?? {
                        label: c.status,
                        cls: "text-text-tertiary",
                      };
                      return (
                        <li
                          key={c.id}
                          className="flex items-baseline justify-between gap-2 text-xs text-text-secondary"
                        >
                          <span className="truncate">
                            {c.type === "ENGINE_OFF" ? "Apagar" : "Encender"}
                            {c.reason ? ` · ${c.reason.toLowerCase()}` : ""}
                          </span>
                          <span
                            title={c.rejectionReason ?? undefined}
                            className={`shrink-0 font-mono text-[11px] ${st.cls}`}
                          >
                            {st.label}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-1 flex-col justify-center rounded-lg border border-border bg-surface p-3.5 shadow-soft">
              <EmptyState
                icon={<Navigation aria-hidden="true" className="h-8 w-8" strokeWidth={1.75} />}
                title="Sin vehículo seleccionado"
              >
                Selecciona un vehículo de la lista o toca un punto en el mapa para ver su
                telemetría EV y las acciones de seguridad.
              </EmptyState>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
