import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import {
  Card,
  EmptyState,
  Loading,
  ModuleDisabled,
  PageHeader,
  tableRowClass,
  theadRowClass,
} from "../components/ui";

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

export default function Ev() {
  const [fleet, setFleet] = useState<EvVehicle[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [moduleOff, setModuleOff] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [f, s] = await Promise.all([
          api<EvVehicle[]>("GET", "/ev/overview"),
          api<Station[]>("GET", "/ev/charging-stations"),
        ]);
        setFleet(f);
        setStations(s);
      } catch (err) {
        if (err instanceof ApiError && err.code === "MODULE_NOT_ENABLED") {
          setModuleOff(true);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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

      <Card title="Red de carga cercana (Bogotá)">
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
            {stations.map((s) => (
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
          </tbody>
        </table>
        </div>
      </Card>
    </div>
  );
}
