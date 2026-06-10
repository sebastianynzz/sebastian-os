import { useEffect, useState } from "react";
import { api } from "../api";
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
  operatedBy: { id: string; name: string; operatorType: string };
  ownerName: string | null;
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
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Flota en sitio (FaaS)</h1>
      <p className="text-sm text-cielo">
        Vehículos propiedad de MOVE operando en las instalaciones de clientes.
        Telemetría y estado del activo a través de todos los tenants.
      </p>
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
                  {v.lastSeenAt ? new Date(v.lastSeenAt).toLocaleString("es-CO") : "sin señal"}
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
