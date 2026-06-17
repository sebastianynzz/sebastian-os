import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { formatDateTimeBogota } from "@moveos/shared";
import { api, BASE_URL, getToken } from "../api";
import { Card } from "../components/ui";

/**
 * Flota propia de MOVE operando en tenants de clientes (fleet-as-a-service):
 * vista cruzada del plano de plataforma — quién opera cada activo, su estado
 * de telemetría y SoC — sin tocar el plano de datos de cada tenant.
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
  lastLat: number | null;
  lastLng: number | null;
  operatedBy: { id: string; name: string; operatorType: string };
  ownerName: string | null;
}

const BOGOTA: [number, number] = [4.6486, -74.0628];

function dotIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:14px;height:14px;border-radius:9999px;background:${color};border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.35)"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

/** Encuadra el mapa a la flota una sola vez (sin re-encuadrar en cada ping). */
function FitToFleet({ points }: { points: [number, number][] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || points.length === 0) return;
    map.fitBounds(L.latLngBounds(points).pad(0.25));
    fitted.current = true;
  }, [points, map]);
  return null;
}

export default function Flota() {
  const [vehicles, setVehicles] = useState<OwnedVehicle[]>([]);
  const [loaded, setLoaded] = useState(false);

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

  // Vehículos con posición conocida (los demás solo salen en la tabla).
  const located = useMemo(
    () => vehicles.filter((v) => v.lastLat !== null && v.lastLng !== null),
    [vehicles],
  );
  const points = useMemo(
    () => located.map((v) => [v.lastLat!, v.lastLng!] as [number, number]),
    [located],
  );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Flota en sitio (FaaS)</h1>
      <p className="text-sm text-cielo">
        Vehículos propiedad de MOVE operando en las instalaciones de clientes.
        Telemetría y estado del activo a través de todos los tenants.
      </p>

      {located.length > 0 && (
        <Card>
          <MapContainer
            center={points[0] ?? BOGOTA}
            zoom={11}
            className="h-[360px] w-full overflow-hidden rounded-lg"
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <FitToFleet points={points} />
            {/* Agrupa vehículos cercanos; se separan al hacer zoom/clic. */}
            <MarkerClusterGroup chunkedLoading>
              {located.map((v) => (
                <Marker
                  key={v.id}
                  position={[v.lastLat!, v.lastLng!]}
                  icon={dotIcon(v.engineOn ? "#16a34a" : "#dc2626")}
                >
                  <Popup>
                    <strong>
                      {v.plate} {v.isElectric && "⚡"} {v.immobilized && "🔒"}
                    </strong>
                    <br />
                    {v.type} · opera en {v.operatedBy.name}
                    <br />
                    {v.engineOn ? "Encendido" : "Apagado"} ·{" "}
                    {v.socPercent !== null ? `SoC ${v.socPercent}%` : "SoC —"}
                    <br />
                    {v.lastSeenAt ? formatDateTimeBogota(v.lastSeenAt) : "sin señal"}
                  </Popup>
                </Marker>
              ))}
            </MarkerClusterGroup>
          </MapContainer>
        </Card>
      )}

      <Card>
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
            {vehicles.map((v) => (
              <tr key={v.id} className="border-b border-white/5">
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
                  {v.lastSpeedKmh !== null ? `${v.lastSpeedKmh.toFixed(0)} km/h` : "—"}
                </td>
                <td className="text-xs text-cielo">
                  {v.lastSeenAt ? formatDateTimeBogota(v.lastSeenAt) : "sin señal"}
                </td>
              </tr>
            ))}
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
