import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import { formatDateTimeBogota } from "@moveos/shared";
import { api, BASE_URL, getToken } from "../api";
import { Card } from "../components/ui";

/**
 * Flota propia de MOVE operando en tenants de clientes (fleet-as-a-service):
 * vista cruzada del plano de plataforma — quién opera cada activo, su estado
 * de telemetría, SoC y posición en vivo — sin tocar el plano de datos de cada
 * tenant. Mapa agrupado + tabla, alimentados por el mismo stream SSE.
 */

interface OwnedVehicle {
  id: string;
  plate: string;
  type: string;
  isElectric: boolean;
  socPercent: number | null;
  engineOn: boolean;
  immobilized: boolean;
  lastSpeedKmh: number | null;
  lastSeenAt: string | null;
  operatedBy: { id: string; name: string; operatorType: string };
  ownerName: string | null;
  // Telemetría EV-only (Constraint 1): nunca RPM/combustible/refrigerante.
  position: {
    lat: number;
    lng: number;
    speedKmh: number | null;
    recordedAt: string;
  } | null;
}

// Centro del mapa: Bogotá (mismo depósito de referencia que el despacho).
const DEPOT = { lat: 4.6486, lng: -74.0628 };
// Un ping con más de 2 min se considera rancio (vehículo "mudo").
const STALE_MS = 2 * 60 * 1000;

function isStale(recordedAt: string): boolean {
  return Date.now() - new Date(recordedAt).getTime() > STALE_MS;
}

/** Marcador de color: gris = señal rancia, verde = motor encendido, rojo = apagado. */
function dotIcon(color: string, locked: boolean) {
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:16px;height:16px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.3)">${
      locked ? '<span style="position:absolute;top:-10px;right:-8px;font-size:11px">🔒</span>' : ""
    }</div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}
const depotIcon = new L.Icon({
  iconUrl: markerIconUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

function markerColor(v: OwnedVehicle): string {
  if (!v.position || isStale(v.position.recordedAt)) return "#9ca3af";
  return v.engineOn ? "#16a34a" : "#dc2626";
}

/** Encuadra el mapa sobre los vehículos con posición (una sola vez al cargar). */
function FitToVehicles({ vehicles }: { vehicles: OwnedVehicle[] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current) return;
    const pts = vehicles
      .filter((v) => v.position)
      .map((v) => [v.position!.lat, v.position!.lng] as [number, number]);
    if (pts.length > 0) {
      map.fitBounds(L.latLngBounds([...pts, [DEPOT.lat, DEPOT.lng]]).pad(0.2));
      fitted.current = true;
    }
  }, [vehicles, map]);
  return null;
}

/**
 * Seguir un vehículo: recentra el mapa sobre el activo seleccionado en cada
 * actualización de posición. Si el operador arrastra el mapa, deja de seguir
 * para no pelear su gesto (panTo programático no dispara `dragstart`).
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

export default function Flota() {
  const [vehicles, setVehicles] = useState<OwnedVehicle[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [follow, setFollow] = useState(false);
  const stopFollow = useCallback(() => setFollow(false), []);

  const load = useCallback(async () => {
    try {
      setVehicles(await api<OwnedVehicle[]>("GET", "/tenants/fleet/owned"));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    // Tiempo real: la telemetría de activos FaaS llega por SSE. Queda un
    // respaldo lento por si el stream se cae.
    const token = getToken();
    let es: EventSource | null = null;
    if (token && typeof EventSource !== "undefined") {
      es = new EventSource(
        `${BASE_URL}/realtime/platform/stream?token=${encodeURIComponent(token)}`,
      );
      es.addEventListener("fleet", () => void load());
    }
    const interval = setInterval(() => void load(), 60000);
    return () => {
      es?.close();
      clearInterval(interval);
    };
  }, [load]);

  const withPosition = useMemo(() => vehicles.filter((v) => v.position), [vehicles]);
  const staleCount = useMemo(
    () => withPosition.filter((v) => isStale(v.position!.recordedAt)).length,
    [withPosition],
  );
  const selectedVehicle = useMemo(
    () => vehicles.find((v) => v.id === selected) ?? null,
    [vehicles, selected],
  );
  const followTarget = selectedVehicle?.position
    ? { lat: selectedVehicle.position.lat, lng: selectedVehicle.position.lng }
    : null;

  function selectVehicle(id: string) {
    setSelected(id);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Flota en sitio (FaaS)</h1>
          <p className="text-sm text-cielo">
            Vehículos propiedad de MOVE operando en las instalaciones de
            clientes. Telemetría, posición y estado del activo a través de todos
            los tenants.
          </p>
        </div>
        <div className="text-right text-xs text-cielo">
          <div>
            {withPosition.length} de {vehicles.length} reportando posición · en
            tiempo real
          </div>
          {staleCount > 0 && (
            <div className="text-amber-300">
              {staleCount} con señal rancia (&gt;2 min)
            </div>
          )}
        </div>
      </div>

      {error && (
        <Card>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-red-300">
              No se pudo cargar la flota. Reintentando automáticamente…
            </span>
            <button
              onClick={() => void load()}
              className="rounded-lg bg-lima px-3 py-1.5 font-semibold text-navy"
            >
              Reintentar
            </button>
          </div>
        </Card>
      )}

      <Card>
        {selectedVehicle && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              Seleccionado:{" "}
              <span className="font-mono font-medium">
                {selectedVehicle.plate}
              </span>{" "}
              <span className="text-cielo">· {selectedVehicle.operatedBy.name}</span>
            </span>
            <button
              onClick={() => setFollow((f) => !f)}
              aria-pressed={follow}
              disabled={!followTarget}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${
                follow ? "bg-lima text-navy" : "bg-white/10 text-niebla"
              }`}
            >
              {follow
                ? "📍 Siguiendo — toca para soltar"
                : followTarget
                  ? "📍 Seguir en el mapa"
                  : "Sin posición para seguir"}
            </button>
          </div>
        )}
        <MapContainer
          center={[DEPOT.lat, DEPOT.lng]}
          zoom={12}
          className="h-[360px] w-full rounded-lg lg:h-[460px]"
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <FitToVehicles vehicles={vehicles} />
          <FollowVehicle target={followTarget} follow={follow} onUserPan={stopFollow} />
          <Marker position={[DEPOT.lat, DEPOT.lng]} icon={depotIcon}>
            <Popup>Bogotá (referencia)</Popup>
          </Marker>
          {/* Agrupa activos cercanos en burbujas con conteo; se separan al hacer
              zoom o clic. chunkedLoading evita trabar el hilo con flotas grandes. */}
          <MarkerClusterGroup chunkedLoading>
            {withPosition.map((v) => {
              const stale = isStale(v.position!.recordedAt);
              return (
                <Marker
                  key={v.id}
                  position={[v.position!.lat, v.position!.lng]}
                  icon={dotIcon(markerColor(v), v.immobilized)}
                  eventHandlers={{ click: () => selectVehicle(v.id) }}
                >
                  <Popup>
                    <strong>{v.plate}</strong> {v.isElectric && "⚡"}
                    <br />
                    {v.type}
                    <br />
                    Opera: {v.operatedBy.name}
                    <br />
                    {v.engineOn ? "Encendido" : "Apagado"}
                    {v.immobilized && " · 🔒 inmovilizado"}
                    <br />
                    SoC: {v.socPercent !== null ? `${v.socPercent}%` : "—"} ·{" "}
                    {(v.position!.speedKmh ?? 0).toFixed(0)} km/h
                    <br />
                    {stale ? "⚠️ señal rancia · " : ""}
                    {formatDateTimeBogota(v.position!.recordedAt)}
                  </Popup>
                </Marker>
              );
            })}
          </MarkerClusterGroup>
        </MapContainer>
      </Card>

      <Card>
        {!loaded ? (
          <p className="py-8 text-center text-cielo">Cargando flota…</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase text-cielo/60">
                <th className="py-2">Placa</th>
                <th>Tipo</th>
                <th>Opera en</th>
                <th>Dueño</th>
                <th>Motor</th>
                <th>SoC</th>
                <th>Velocidad</th>
                <th>Visto</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v) => {
                const stale = v.position ? isStale(v.position.recordedAt) : false;
                return (
                  <tr
                    key={v.id}
                    onClick={() => selectVehicle(v.id)}
                    className={`cursor-pointer border-b border-white/5 ${
                      selected === v.id ? "bg-lima/10" : "hover:bg-white/5"
                    }`}
                  >
                    <td className="py-2 font-mono font-medium">
                      {v.plate} {v.isElectric && "⚡"} {v.immobilized && "🔒"}
                    </td>
                    <td className="text-cielo">{v.type}</td>
                    <td>{v.operatedBy.name}</td>
                    <td className="text-cielo">{v.ownerName ?? "—"}</td>
                    <td>
                      <span className={v.engineOn ? "text-lima" : "text-red-400"}>
                        {v.engineOn ? "● encendido" : "○ apagado"}
                      </span>
                    </td>
                    <td>{v.socPercent !== null ? `${v.socPercent}%` : "—"}</td>
                    <td>
                      {v.lastSpeedKmh !== null
                        ? `${v.lastSpeedKmh.toFixed(0)} km/h`
                        : "—"}
                    </td>
                    <td className="text-xs text-cielo">
                      {v.position
                        ? `${stale ? "⚠️ " : ""}${formatDateTimeBogota(v.position.recordedAt)}`
                        : v.lastSeenAt
                          ? formatDateTimeBogota(v.lastSeenAt)
                          : "sin señal"}
                    </td>
                  </tr>
                );
              })}
              {loaded && vehicles.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-white/30">
                    Sin vehículos en sitio todavía. Aprovisiona un cliente FaaS y
                    asígnale vehículos desde su detalle.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
