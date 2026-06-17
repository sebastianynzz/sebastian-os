import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  inputClass,
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
  connectors: string[];
  powerKw: number | null;
  dcFast: boolean;
  isDepot: boolean;
}
interface RangeEstimate {
  vehicleId: string;
  plate: string;
  socPercent: number;
  usableRangeKm: number;
}

export default function Ev() {
  const [fleet, setFleet] = useState<EvVehicle[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [moduleOff, setModuleOff] = useState(false);

  // Calculadora de autonomía: condiciones de operación → autonomía útil.
  const [calcVehicleId, setCalcVehicleId] = useState("");
  const [temperatureC, setTemperatureC] = useState("");
  const [payloadKg, setPayloadKg] = useState("");
  const [elevationGainM, setElevationGainM] = useState("");
  const [estimate, setEstimate] = useState<RangeEstimate | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [calcBusy, setCalcBusy] = useState(false);

  // Búsqueda del directorio de carga (cliente: las estaciones ya están en memoria).
  const [stationQuery, setStationQuery] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const [f, s] = await Promise.all([
          api<EvVehicle[]>("GET", "/ev/overview"),
          api<Station[]>("GET", "/ev/charging-stations"),
        ]);
        setFleet(f);
        setStations(s);
        // Solo los EV con autonomía nominal son calculables (la derivamos del
        // pack instalado vía VEHICLE_TYPE_PROFILES al crearlos).
        const firstCalc = f.find((v) => v.nominalRangeKm !== null);
        if (firstCalc) setCalcVehicleId(firstCalc.id);
      } catch (err) {
        if (err instanceof ApiError && err.code === "MODULE_NOT_ENABLED") {
          setModuleOff(true);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const calculable = useMemo(
    () => fleet.filter((v) => v.nominalRangeKm !== null),
    [fleet],
  );

  const filteredStations = useMemo(() => {
    const q = stationQuery.trim().toLowerCase();
    if (!q) return stations;
    return stations.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.network.toLowerCase().includes(q) ||
        s.connectors.some((c) => c.toLowerCase().includes(q)),
    );
  }, [stations, stationQuery]);

  async function calcular() {
    if (!calcVehicleId) return;
    setCalcBusy(true);
    setCalcError(null);
    setEstimate(null);
    const params = new URLSearchParams({ vehicleId: calcVehicleId });
    if (temperatureC !== "") params.set("temperatureC", temperatureC);
    if (payloadKg !== "") params.set("payloadKg", payloadKg);
    if (elevationGainM !== "") params.set("elevationGainM", elevationGainM);
    try {
      setEstimate(await api<RangeEstimate>("GET", `/ev/range-estimate?${params}`));
    } catch (err) {
      setCalcError(err instanceof ApiError ? err.message : "No se pudo estimar la autonomía.");
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Flota eléctrica"
        subtitle="Autonomía útil estimada según estado de carga, con margen de seguridad.
          Los EVs están exentos de pico y placa (Ley 1964 de 2019)."
      />

      {/* Programación de carga al menor costo (asesor): el solver calcula la
          energía y la ventana tarifaria; el LLM solo explica. */}
      <AiOptimizeButton actionId="optimize_charging" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {fleet.map((v) => (
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
            </div>
          </Card>
        ))}
        {fleet.length === 0 && (
          <Card>
            <EmptyState>
              No hay vehículos eléctricos registrados. Márquelos como eléctricos
              al crearlos en Vehículos.
            </EmptyState>
          </Card>
        )}
      </div>

      {/* Calculadora de autonomía: temperatura, carga y desnivel deratean la
          autonomía nominal (mismo modelo que usa el optimizador para planear). */}
      <Card title="Calculadora de autonomía">
        {calculable.length === 0 ? (
          <EmptyState>
            Configura la autonomía nominal de al menos un EV (al crearlo en
            Vehículos) para estimar autonomía bajo condiciones de operación.
          </EmptyState>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Vehículo">
                <select
                  className={inputClass}
                  value={calcVehicleId}
                  onChange={(e) => setCalcVehicleId(e.target.value)}
                >
                  {calculable.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.plate} · {v.type}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Temperatura (°C)">
                <input
                  type="number"
                  className={inputClass}
                  placeholder="21"
                  value={temperatureC}
                  onChange={(e) => setTemperatureC(e.target.value)}
                />
              </Field>
              <Field label="Carga (kg)">
                <input
                  type="number"
                  min="0"
                  className={inputClass}
                  placeholder="0"
                  value={payloadKg}
                  onChange={(e) => setPayloadKg(e.target.value)}
                />
              </Field>
              <Field label="Desnivel acumulado (m)">
                <input
                  type="number"
                  min="0"
                  className={inputClass}
                  placeholder="0"
                  value={elevationGainM}
                  onChange={(e) => setElevationGainM(e.target.value)}
                />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={calcular} disabled={calcBusy || !calcVehicleId}>
                {calcBusy ? "Calculando…" : "Calcular autonomía"}
              </Button>
              {estimate && (
                <span className="text-sm text-navy">
                  Autonomía útil estimada:{" "}
                  <strong className="text-lg">{estimate.usableRangeKm} km</strong>{" "}
                  <span className="text-navy/50">(SoC {estimate.socPercent}%)</span>
                </span>
              )}
            </div>
            {calcError && (
              <Banner kind="error" onDismiss={() => setCalcError(null)}>
                {calcError}
              </Banner>
            )}
          </div>
        )}
      </Card>

      <Card
        title="Red de carga cercana (Bogotá)"
        actions={
          <input
            type="search"
            className={`${inputClass} sm:w-64`}
            placeholder="Buscar estación, red o conector…"
            value={stationQuery}
            onChange={(e) => setStationQuery(e.target.value)}
            aria-label="Buscar en el directorio de carga"
          />
        }
      >
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className={theadRowClass}>
              <th className="py-1">Estación</th>
              <th>Red</th>
              <th>Conectores</th>
              <th>Carga rápida</th>
            </tr>
          </thead>
          <tbody>
            {filteredStations.map((s) => (
              <tr key={s.id} className={tableRowClass}>
                <td className="py-1.5">{s.isDepot ? `🏠 ${s.name}` : s.name}</td>
                <td>{s.network}</td>
                <td className="text-xs">{s.connectors.join(", ")}</td>
                <td>
                  {s.dcFast ? "⚡ DC" : "AC"}
                  {s.powerKw ? ` · ${s.powerKw} kW` : ""}
                </td>
              </tr>
            ))}
            {filteredStations.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-navy/40">
                  Sin estaciones que coincidan con «{stationQuery}».
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
