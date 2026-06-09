import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Card } from "../components/ui";

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
  name: string;
  network: string;
  connectors: string[];
  dc: boolean;
}

export default function Ev() {
  const [fleet, setFleet] = useState<EvVehicle[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
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
      }
    })();
  }, []);

  if (moduleOff) {
    return (
      <Card title="Flota eléctrica">
        <p className="text-sm text-slate-500">
          El módulo de gestión EV no está activo. Actívelo en Módulos.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Flota eléctrica</h1>
      <p className="text-sm text-slate-500">
        Autonomía útil estimada según estado de carga, con margen de seguridad.
        Los EVs están exentos de pico y placa (Ley 1964 de 2019).
      </p>

      <div className="grid grid-cols-3 gap-4">
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
                <span className="text-slate-500">Estado de carga</span>
                <span className="font-medium">{v.socPercent ?? "—"}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${(v.socPercent ?? 0) < 25 ? "bg-red-500" : "bg-emerald-500"}`}
                  style={{ width: `${v.socPercent ?? 0}%` }}
                />
              </div>
              <div className="flex justify-between pt-1">
                <span className="text-slate-500">Autonomía útil</span>
                <span className="font-medium">{v.usableRangeKm ?? "—"} km</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Batería</span>
                <span>{v.batteryKwh ?? "—"} kWh</span>
              </div>
            </div>
          </Card>
        ))}
        {fleet.length === 0 && (
          <Card>
            <p className="text-sm text-slate-400">
              No hay vehículos eléctricos registrados.
            </p>
          </Card>
        )}
      </div>

      <Card title="Red de carga cercana (Bogotá)">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
              <th className="py-1">Estación</th>
              <th>Red</th>
              <th>Conectores</th>
              <th>Carga rápida</th>
            </tr>
          </thead>
          <tbody>
            {stations.map((s) => (
              <tr key={s.name} className="border-b border-slate-100">
                <td className="py-1.5">{s.name}</td>
                <td>{s.network}</td>
                <td className="text-xs">{s.connectors.join(", ")}</td>
                <td>{s.dc ? "⚡ DC" : "AC"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
