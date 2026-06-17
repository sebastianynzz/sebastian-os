import { useEffect, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import { VEHICLE_TYPE_PROFILES } from "@moveos/shared";
import { api, ApiError } from "../api";
import {
  Button,
  Card,
  EmptyState,
  Loading,
  ModuleDisabled,
  PageHeader,
  tableRowClass,
  theadRowClass,
} from "../components/ui";
import { AiOptimizeButton } from "../components/AiOptimizeButton";

interface EvVehicle {
  id: string;
  plate: string;
  type: string;
  batteryKwh: number | null;
  nominalRangeKm: number | null;
  socPercent: number | null;
  usableRangeKm: number | null;
  lowBattery: boolean;
}
interface Station {
  id: string;
  name: string;
  network: string;
  address: string | null;
  city: string | null;
  lat: number;
  lng: number;
  connectors: string[];
  powerKw: number | null;
  dcFast: boolean;
  isDepot: boolean;
  distanceKm: number | null;
}
interface RangeEstimate {
  vehicleId: string;
  plate: string;
  socPercent: number;
  usableRangeKm: number;
}

const DEPOT = { lat: 4.6486, lng: -74.0628 }; // referencia Bogotá

const stationIcon = new L.Icon({
  iconUrl: markerIconUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

/** Consumo del reefer (kW): puede venir como rango [min,max] o valor único. */
function coolingDrawLabel(draw: number | [number, number]): string {
  return Array.isArray(draw) ? `${draw[0]}–${draw[1]} kW` : `${draw} kW`;
}
function reeferOf(type: string) {
  return VEHICLE_TYPE_PROFILES[type as keyof typeof VEHICLE_TYPE_PROFILES]?.reefer ?? null;
}

const numInput =
  "w-full rounded-lg border border-cielo px-2 py-1 text-sm focus:border-navy focus:outline-none";

export default function Ev() {
  const [fleet, setFleet] = useState<EvVehicle[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [moduleOff, setModuleOff] = useState(false);
  const [stationQuery, setStationQuery] = useState("");

  // Calculadora de autonomía (surface del backend /ev/range-estimate).
  const [calcVehicle, setCalcVehicle] = useState("");
  const [temp, setTemp] = useState("");
  const [payload, setPayload] = useState("");
  const [elev, setElev] = useState("");
  const [calc, setCalc] = useState<RangeEstimate | null>(null);
  const [calcBusy, setCalcBusy] = useState(false);
  const [calcErr, setCalcErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [f, s] = await Promise.all([
          api<EvVehicle[]>("GET", "/ev/overview"),
          // Con origen (depósito) el backend ordena por cercanía y llena distanceKm.
          api<Station[]>(
            "GET",
            `/ev/charging-stations?lat=${DEPOT.lat}&lng=${DEPOT.lng}`,
          ),
        ]);
        setFleet(f);
        setStations(s);
        setCalcVehicle(f[0]?.id ?? "");
      } catch (err) {
        if (err instanceof ApiError && err.code === "MODULE_NOT_ENABLED") {
          setModuleOff(true);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function runCalc() {
    if (!calcVehicle) return;
    setCalcBusy(true);
    setCalcErr(null);
    const p = new URLSearchParams({ vehicleId: calcVehicle });
    if (temp) p.set("temperatureC", temp);
    if (payload) p.set("payloadKg", payload);
    if (elev) p.set("elevationGainM", elev);
    try {
      setCalc(await api<RangeEstimate>("GET", `/ev/range-estimate?${p.toString()}`));
    } catch (err) {
      setCalc(null);
      setCalcErr(err instanceof Error ? err.message : "No se pudo estimar la autonomía");
    } finally {
      setCalcBusy(false);
    }
  }

  if (moduleOff) {
    return <ModuleDisabled title="Flota eléctrica" moduleName="de gestión EV" />;
  }
  if (loading) {
    return <Loading label="Cargando flota eléctrica…" />;
  }

  const q = stationQuery.trim().toLowerCase();
  const filteredStations = q
    ? stations.filter((s) =>
        [s.name, s.network, s.city ?? "", s.address ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
    : stations;
  const lowCount = fleet.filter((v) => v.lowBattery).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Flota eléctrica"
        subtitle="Autonomía útil estimada según estado de carga, con margen de seguridad.
          Los EVs están exentos de pico y placa (Ley 1964 de 2019)."
        actions={
          lowCount > 0 ? (
            <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
              {lowCount} con batería baja
            </span>
          ) : undefined
        }
      />

      {/* Programación de carga al menor costo (asesor): el solver calcula la
          energía y la ventana tarifaria; el LLM solo explica. */}
      <AiOptimizeButton actionId="optimize_charging" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {fleet.map((v) => {
          const reefer = reeferOf(v.type);
          return (
            <Card key={v.id}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-lg font-bold">{v.plate}</span>
                {v.lowBattery && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                    Batería baja
                  </span>
                )}
              </div>
              <div className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-navy/50">Estado de carga</span>
                  <span className="font-medium">{v.socPercent ?? "—"}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-niebla">
                  <div
                    className={`h-full rounded-full ${(v.socPercent ?? 0) < 25 ? "bg-red-500" : "bg-emerald-500"}`}
                    style={{ width: `${v.socPercent ?? 0}%` }}
                  />
                </div>
                <div className="flex justify-between pt-1">
                  <span className="text-navy/50">Autonomía útil</span>
                  <span className="font-medium">{v.usableRangeKm ?? "—"} km</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-navy/50">Batería</span>
                  <span>{v.batteryKwh ?? "—"} kWh</span>
                </div>
                {/* Consumo del reefer (Cold Box): la autonomía publicada ya es
                    reefer-ON, así que esto es informativo (energía/costo), no se
                    resta de nuevo. Solo configuraciones refrigeradas lo muestran. */}
                {reefer && (
                  <div className="flex justify-between">
                    <span className="text-navy/50">Refrigeración</span>
                    <span className="text-xs">
                      {coolingDrawLabel(reefer.coolingDrawKw)} · {reefer.tempMinC}…
                      {reefer.tempMaxC}°C
                    </span>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
        {fleet.length === 0 && (
          <Card>
            <EmptyState>
              No hay vehículos eléctricos registrados. Márquelos como eléctricos
              al crearlos en Vehículos.
            </EmptyState>
          </Card>
        )}
      </div>

      {fleet.length > 0 && (
        <Card title="Calculadora de autonomía">
          <p className="mb-3 text-sm text-navy/60">
            Estima la autonomía útil bajo condiciones de operación (temperatura,
            carga y desnivel) sobre el estado de carga actual del vehículo.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="text-xs text-navy/60">
              Vehículo
              <select
                value={calcVehicle}
                onChange={(e) => setCalcVehicle(e.target.value)}
                className={numInput}
              >
                {fleet.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.plate}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-navy/60">
              Temperatura °C
              <input
                type="number"
                value={temp}
                onChange={(e) => setTemp(e.target.value)}
                placeholder="ej. 12"
                className={numInput}
              />
            </label>
            <label className="text-xs text-navy/60">
              Carga kg
              <input
                type="number"
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                placeholder="ej. 150"
                className={numInput}
              />
            </label>
            <label className="text-xs text-navy/60">
              Desnivel m
              <input
                type="number"
                value={elev}
                onChange={(e) => setElev(e.target.value)}
                placeholder="ej. 300"
                className={numInput}
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button onClick={() => void runCalc()} disabled={calcBusy || !calcVehicle}>
              {calcBusy ? "Calculando…" : "Calcular autonomía"}
            </Button>
            {calc && (
              <span className="text-sm">
                <span className="font-mono font-bold">{calc.plate}</span> · SoC{" "}
                {calc.socPercent}% →{" "}
                <span className="text-lg font-bold text-emerald-600">
                  {calc.usableRangeKm} km
                </span>{" "}
                útiles
              </span>
            )}
            {calcErr && <span className="text-sm text-red-700">{calcErr}</span>}
          </div>
        </Card>
      )}

      <Card title="Red de carga (Bogotá)">
        <input
          type="search"
          value={stationQuery}
          onChange={(e) => setStationQuery(e.target.value)}
          placeholder="Buscar por estación, red, ciudad o dirección…"
          aria-label="Buscar estación de carga"
          className={`${numInput} mb-3 sm:max-w-sm`}
        />

        <div className="mb-3 overflow-hidden rounded-lg">
          <MapContainer center={[DEPOT.lat, DEPOT.lng]} zoom={12} style={{ height: 280 }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {filteredStations.map((s) => (
              <Marker key={s.id} position={[s.lat, s.lng]} icon={stationIcon}>
                <Popup>
                  <strong>
                    {s.isDepot ? "🏠 " : ""}
                    {s.name}
                  </strong>
                  <br />
                  {s.network} · {s.dcFast ? "⚡ DC" : "AC"}
                  {s.powerKw ? ` · ${s.powerKw} kW` : ""}
                  {s.address ? (
                    <>
                      <br />
                      {s.address}
                    </>
                  ) : null}
                  {s.distanceKm !== null ? (
                    <>
                      <br />a {s.distanceKm} km del depósito
                    </>
                  ) : null}
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={theadRowClass}>
                <th className="py-1">Estación</th>
                <th>Red</th>
                <th>Ciudad</th>
                <th>Conectores</th>
                <th>Carga</th>
                <th className="text-right">Distancia</th>
              </tr>
            </thead>
            <tbody>
              {filteredStations.map((s) => (
                <tr key={s.id} className={tableRowClass}>
                  <td className="py-1.5">{s.isDepot ? `🏠 ${s.name}` : s.name}</td>
                  <td>{s.network}</td>
                  <td className="text-xs">{s.city ?? "—"}</td>
                  <td className="text-xs">{s.connectors.join(", ")}</td>
                  <td>
                    {s.dcFast ? "⚡ DC" : "AC"}
                    {s.powerKw ? ` · ${s.powerKw} kW` : ""}
                  </td>
                  <td className="text-right font-mono text-xs">
                    {s.distanceKm !== null ? `${s.distanceKm} km` : "—"}
                  </td>
                </tr>
              ))}
              {filteredStations.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-navy/40">
                    {stations.length === 0
                      ? "Sin estaciones registradas."
                      : "Ninguna estación coincide con la búsqueda."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
