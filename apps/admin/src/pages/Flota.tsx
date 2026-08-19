import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { formatDateTimeBogota } from "@moveos/shared";
import { api, BASE_URL, getToken } from "../api";
import { Card } from "../components/ui";

/**
 * Flota propia de MOVE operando en tenants de clientes (fleet-as-a-service):
 * vista cruzada del plano de plataforma — quién opera cada activo, su estado
 * de telemetría y SoC — sin tocar el plano de datos de cada tenant.
 *
 * Mapa agrupado: los activos pueden estar repartidos por varias ciudades, así
 * que se agrupan en burbujas con conteo y se separan al hacer zoom/clic. La
 * posición llega denormalizada en lastLat/lastLng (último ping); los vehículos
 * que aún no reportan quedan fuera del mapa y se marcan "sin señal" en la tabla.
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
  lastLat: number | null;
  lastLng: number | null;
  lastSeenAt: string | null;
  operatedBy: { id: string; name: string; operatorType: string };
  ownerName: string | null;
}

// Centro por defecto (Bogotá) hasta que haya posiciones para encuadrar.
const DEFAULT_CENTER: [number, number] = [4.65, -74.06];
// Señal vieja: sin ping en los últimos 5 min → marcador gris.
const STALE_MS = 5 * 60 * 1000;

function isStale(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return true;
  return Date.now() - new Date(lastSeenAt).getTime() > STALE_MS;
}

/** Color del marcador: gris = señal vieja, verde = encendido, rojo = apagado. */
function statusColor(v: OwnedVehicle): string {
  if (isStale(v.lastSeenAt)) return "#9ca3af";
  return v.engineOn ? "#16a34a" : "#dc2626";
}

function dotIcon(color: string, immobilized: boolean) {
  const lock = immobilized
    ? `<div style="position:absolute;top:-8px;right:-8px;font-size:11px">🔒</div>`
    : "";
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #F2F5F3">${lock}</div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

/** Encuadra el mapa sobre los vehículos posicionados (solo en la primera carga). */
function FitToVehicles({ points }: { points: [number, number][] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || points.length === 0) return;
    map.fitBounds(L.latLngBounds(points).pad(0.2));
    fitted.current = true;
  }, [points, map]);
  return null;
}

/** Centra el mapa sobre un vehículo al hacer clic en su placa en la tabla. */
function FocusVehicle({ target }: { target: { lat: number; lng: number; key: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [target?.key, map]);
  return null;
}

export default function Flota() {
  const [vehicles, setVehicles] = useState<OwnedVehicle[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  // Clave incremental para re-disparar el vuelo aunque se reseleccione el mismo.
  const [focus, setFocus] = useState<{ lat: number; lng: number; key: number } | null>(null);

  async function load() {
    setVehicles(await api<OwnedVehicle[]>("GET", "/tenants/fleet/owned"));
    setLoaded(true);
  }
  useEffect(() => {
    void load();
    // Tiempo real: la telemetría de activos FaaS llega por SSE (antes: sondeo
    // cada 15 s). Queda un respaldo lento por si el stream se cae.
    const token = getToken();
    let es: EventSource | null = null;
    if (token && typeof EventSource !== "undefined") {
      es = new EventSource(
        `${BASE_URL}/realtime/platform/stream?token=${encodeURIComponent(token)}`,
      );
      es.addEventListener("fleet", () => void load());
    }
    const interval = setInterval(load, 60000);
    return () => {
      es?.close();
      clearInterval(interval);
    };
  }, []);

  const positioned = useMemo(
    () => vehicles.filter((v) => v.lastLat !== null && v.lastLng !== null),
    [vehicles],
  );
  const points = useMemo<[number, number][]>(
    () => positioned.map((v) => [v.lastLat as number, v.lastLng as number]),
    [positioned],
  );
  const noFix = vehicles.length - positioned.length;

  function locate(v: OwnedVehicle) {
    if (v.lastLat === null || v.lastLng === null) return;
    setSelected(v.id);
    setFocus({ lat: v.lastLat, lng: v.lastLng, key: Date.now() });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Flota en sitio (FaaS)</h1>
      <p className="text-sm text-gris-senal">
        Vehículos propiedad de MOVE operando en las instalaciones de clientes.
        Telemetría y estado del activo a través de todos los tenants.
      </p>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gris-senal/70">
          <span>
            {positioned.length} en el mapa
            {noFix > 0 && ` · ${noFix} sin posición`}
          </span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <i className="inline-block h-2.5 w-2.5 rounded-full bg-[#16a34a]" /> encendido
            </span>
            <span className="flex items-center gap-1">
              <i className="inline-block h-2.5 w-2.5 rounded-full bg-[#dc2626]" /> apagado
            </span>
            <span className="flex items-center gap-1">
              <i className="inline-block h-2.5 w-2.5 rounded-full bg-[#9ca3af]" /> señal vieja
            </span>
          </span>
        </div>
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={11}
          className="h-[360px] w-full rounded-lg lg:h-[480px]"
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <FitToVehicles points={points} />
          <FocusVehicle target={focus} />
          {/* chunkedLoading evita trabar el hilo con flotas grandes. */}
          <MarkerClusterGroup chunkedLoading>
            {positioned.map((v) => (
              <Marker
                key={v.id}
                position={[v.lastLat as number, v.lastLng as number]}
                icon={dotIcon(statusColor(v), v.immobilized)}
                eventHandlers={{ click: () => setSelected(v.id) }}
              >
                <Popup>
                  <strong>
                    {v.plate} {v.isElectric && "⚡"} {v.immobilized && "🔒"}
                  </strong>
                  <br />
                  {v.type}
                  <br />
                  Opera: {v.operatedBy.name}
                  <br />
                  Dueño: {v.ownerName ?? "—"}
                  <br />
                  {v.socPercent !== null ? `SoC ${v.socPercent}% · ` : ""}
                  {v.lastSpeedKmh !== null ? `${v.lastSpeedKmh.toFixed(0)} km/h` : "—"}
                  <br />
                  {v.lastSeenAt
                    ? `${isStale(v.lastSeenAt) ? "Señal vieja · " : ""}${formatDateTimeBogota(v.lastSeenAt)}`
                    : "sin señal"}
                </Popup>
              </Marker>
            ))}
          </MarkerClusterGroup>
        </MapContainer>
      </Card>

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs uppercase text-gris-senal/60">
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
              const hasFix = v.lastLat !== null && v.lastLng !== null;
              return (
                <tr
                  key={v.id}
                  className={`border-b border-white/5 ${selected === v.id ? "bg-verde/10" : ""}`}
                >
                  <td className="py-2 font-mono font-medium">
                    {hasFix ? (
                      <button
                        onClick={() => locate(v)}
                        title="Ubicar en el mapa"
                        className="rounded text-canvas hover:text-verde focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-verde"
                      >
                        {v.plate} {v.isElectric && "⚡"} {v.immobilized && "🔒"}
                      </button>
                    ) : (
                      <span>
                        {v.plate} {v.isElectric && "⚡"} {v.immobilized && "🔒"}
                      </span>
                    )}
                  </td>
                  <td className="text-gris-senal">{v.type}</td>
                  <td>{v.operatedBy.name}</td>
                  <td className="text-gris-senal">{v.ownerName ?? "—"}</td>
                  <td>
                    <span className={v.engineOn ? "text-verde" : "text-red-400"}>
                      {v.engineOn ? "● encendido" : "○ apagado"}
                    </span>
                  </td>
                  <td>{v.socPercent !== null ? `${v.socPercent}%` : "—"}</td>
                  <td>
                    {v.lastSpeedKmh !== null ? `${v.lastSpeedKmh.toFixed(0)} km/h` : "—"}
                  </td>
                  <td className="text-xs text-gris-senal">
                    {v.lastSeenAt ? formatDateTimeBogota(v.lastSeenAt) : "sin señal"}
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
      </Card>
    </div>
  );
}
