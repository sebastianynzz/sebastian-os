import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import { api, ApiError } from "../api";
import { useRealtimeReload } from "../realtime";
import { Button, Card, ModuleDisabled, PageHeader } from "../components/ui";

const DEPOT = { lat: 4.6486, lng: -74.0628 };

/** Marcador de color según estado del motor (verde = encendido, rojo = apagado). */
function dotIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.3)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}
const stationIcon = new L.Icon({
  iconUrl: markerIconUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

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

export default function MapaEnVivo() {
  const [entries, setEntries] = useState<LiveEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [commands, setCommands] = useState<Command[]>([]);
  const [moduleOff, setModuleOff] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
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
      setMessage(
        type === "ENGINE_OFF"
          ? "Comando de apagado enviado. El dispositivo lo confirmará."
          : "Comando de encendido enviado.",
      );
      await loadCommands(selectedEntry.vehicle.id);
    } catch (err) {
      if (err instanceof ApiError && err.code === "VEHICLE_IN_MOTION") {
        setMessage("⛔ " + err.message);
      } else {
        setMessage(err instanceof Error ? err.message : "Error");
      }
    } finally {
      setBusy(false);
    }
  }

  if (moduleOff) {
    return <ModuleDisabled title="Mapa en vivo" moduleName="Telemática" />;
  }

  const moving = selectedEntry && (selectedEntry.vehicle.lastSpeedKmh ?? 0) > 0.5;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Mapa en vivo"
        actions={
          <span className="text-xs text-navy/50">
            {entries.filter((e) => e.ping).length} vehículos reportando · en tiempo real
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <MapContainer
              center={[DEPOT.lat, DEPOT.lng]}
              zoom={12}
              className="h-[320px] w-full lg:h-[460px]"
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <FitToVehicles entries={entries} />
              <FollowVehicle target={followTarget} follow={follow} onUserPan={stopFollow} />
              <Marker position={[DEPOT.lat, DEPOT.lng]} icon={stationIcon}>
                <Popup>Depósito</Popup>
              </Marker>
              {/* Agrupar vehículos cercanos en burbujas con conteo; se separan
                  al hacer zoom o clic. chunkedLoading evita trabar el hilo con
                  flotas grandes. El depósito queda fuera (marcador único). */}
              <MarkerClusterGroup chunkedLoading>
                {entries
                  .filter((e) => e.ping)
                  .map((e) => (
                    <Marker
                      key={e.vehicle.id}
                      position={[e.ping!.lat, e.ping!.lng]}
                      icon={dotIcon(e.vehicle.engineOn ? "#5a6b18" : "#a32d2d")}
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
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Vehículos">
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {entries.length === 0 && (
                <p className="py-2 text-sm text-navy/50">
                  Sin vehículos reportando todavía.
                </p>
              )}
              {entries.map((e) => (
                <button
                  key={e.vehicle.id}
                  onClick={() => selectVehicle(e.vehicle.id)}
                  aria-pressed={selected === e.vehicle.id}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy ${
                    selected === e.vehicle.id ? "bg-cielo/40" : "hover:bg-niebla"
                  }`}
                >
                  <span className="font-mono font-medium">{e.vehicle.plate}</span>
                  <span className="flex items-center gap-2 text-xs">
                    <span className={e.vehicle.engineOn ? "text-success" : "text-danger"}>
                      {e.vehicle.engineOn ? "●" : "○"} {(e.vehicle.lastSpeedKmh ?? 0).toFixed(0)} km/h
                    </span>
                    {e.vehicle.immobilized && <span className="text-danger">🔒</span>}
                  </span>
                </button>
              ))}
            </div>
          </Card>

          {selectedEntry && (
            <Card title={`${selectedEntry.vehicle.plate} · telemetría`}>
              {/* Seguir en el mapa: recentra sobre este vehículo en vivo. Se
                  desactiva solo si el despachador arrastra el mapa. */}
              <button
                onClick={() => setFollow((f) => !f)}
                aria-pressed={follow}
                disabled={!followTarget}
                className={`mb-3 w-full rounded-lg py-2 text-sm font-semibold disabled:opacity-50 ${
                  follow ? "bg-navy text-white" : "bg-niebla text-navy"
                }`}
              >
                {follow ? "📍 Siguiendo — toca para soltar" : "📍 Seguir en el mapa"}
              </button>
              {/* Telemetría EV-only (Constraint 1): SoC y energía, nunca RPM /
                  combustible / temp. de refrigerante — la flota MoveOS es 100 %
                  eléctrica, así que esos campos CAN ICE no se muestran. */}
              <dl className="space-y-1 text-sm">
                <Row label="Velocidad" value={`${(selectedEntry.ping?.speedKmh ?? 0).toFixed(0)} km/h`} />
                <Row label="Sistema" value={selectedEntry.vehicle.engineOn ? "Encendido" : "Apagado"} />
                <Row label="Carga (SoC)" value={`${selectedEntry.vehicle.socPercent?.toFixed(0) ?? "—"}%`} />
                <Row label="Odómetro" value={`${selectedEntry.ping?.odometerKm?.toFixed(0) ?? "—"} km`} />
              </dl>

              <div className="mt-3 border-t border-niebla pt-3">
                <div className="mb-2 text-xs font-semibold uppercase text-navy/50">
                  Inmovilización (anti-robo)
                </div>
                {selectedEntry.vehicle.engineOn ? (
                  <>
                    <Button
                      variant="danger"
                      disabled={busy || !!moving}
                      onClick={() => sendCommand("ENGINE_OFF")}
                    >
                      Apagar motor
                    </Button>
                    {moving && (
                      <p className="mt-1 text-xs text-warning">
                        Solo se puede apagar con el vehículo detenido (seguridad).
                      </p>
                    )}
                  </>
                ) : (
                  <Button variant="secondary" disabled={busy} onClick={() => sendCommand("ENGINE_ON")}>
                    Reactivar motor
                  </Button>
                )}
                {message && <p className="mt-2 text-xs text-navy/70">{message}</p>}
              </div>

              {commands.length > 0 && (
                <div className="mt-3 border-t border-niebla pt-3">
                  <div className="mb-1 text-xs font-semibold uppercase text-navy/50">
                    Historial de comandos
                  </div>
                  <ul className="space-y-1 text-xs">
                    {commands.slice(0, 5).map((c) => (
                      <li key={c.id} className="flex justify-between">
                        <span>{c.type === "ENGINE_OFF" ? "Apagar" : "Encender"}</span>
                        <span className="text-navy/50">{c.status}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-navy/50">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
