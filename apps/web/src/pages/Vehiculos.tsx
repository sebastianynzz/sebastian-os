import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { Button, Card, Field, inputClass } from "../components/ui";

interface Vehicle {
  id: string;
  plate: string;
  type: string;
  capacityKg: number;
  isElectric: boolean;
  batteryKwh: number | null;
  nominalRangeKm: number | null;
  socPercent: number | null;
  soatExpiresAt: string | null;
  tecnoExpiresAt: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  MOTO: "Moto",
  BICICLETA: "Bicicleta",
  CARRO: "Carro",
  VAN: "Van",
  CAMION: "Camión",
};

function docBadge(dateStr: string | null) {
  if (!dateStr) return <span className="text-slate-400">—</span>;
  const days = Math.floor((new Date(dateStr).getTime() - Date.now()) / 86400000);
  if (days < 0) return <span className="font-medium text-red-600">Vencido</span>;
  if (days < 30)
    return <span className="font-medium text-amber-600">{days} días</span>;
  return <span className="text-emerald-600">Vigente</span>;
}

export default function Vehiculos() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [isElectric, setIsElectric] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setVehicles(await api<Vehicle[]>("GET", "/vehicles"));
  }
  useEffect(() => {
    void load();
  }, []);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const data = new FormData(e.currentTarget);
    try {
      await api("POST", "/vehicles", {
        plate: data.get("plate"),
        type: data.get("type"),
        capacityKg: Number(data.get("capacityKg")),
        isElectric,
        batteryKwh: isElectric ? Number(data.get("batteryKwh")) || undefined : undefined,
        nominalRangeKm: isElectric
          ? Number(data.get("nominalRangeKm")) || undefined
          : undefined,
      });
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Vehículos</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancelar" : "Nuevo vehículo"}
        </Button>
      </div>

      {showForm && (
        <Card title="Nuevo vehículo">
          <form onSubmit={onCreate} className="grid grid-cols-3 gap-4">
            <Field label="Placa">
              <input name="plate" className={inputClass} required placeholder="ABC123 / ABC12D" />
            </Field>
            <Field label="Tipo">
              <select name="type" className={inputClass}>
                <option value="MOTO">Moto</option>
                <option value="BICICLETA">Bicicleta</option>
                <option value="CARRO">Carro</option>
                <option value="VAN">Van</option>
                <option value="CAMION">Camión</option>
              </select>
            </Field>
            <Field label="Capacidad (kg)">
              <input name="capacityKg" type="number" className={inputClass} required />
            </Field>
            <label className="col-span-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isElectric}
                onChange={(e) => setIsElectric(e.target.checked)}
              />
              Vehículo eléctrico (exento de pico y placa — Ley 1964)
            </label>
            {isElectric && (
              <>
                <Field label="Batería (kWh)">
                  <input name="batteryKwh" type="number" step="0.1" className={inputClass} />
                </Field>
                <Field label="Autonomía nominal (km)">
                  <input name="nominalRangeKm" type="number" className={inputClass} />
                </Field>
              </>
            )}
            {error && <p className="col-span-3 text-sm text-red-600">{error}</p>}
            <div className="col-span-3">
              <Button type="submit">Crear vehículo</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
              <th className="py-2">Placa</th>
              <th>Tipo</th>
              <th>Capacidad</th>
              <th>EV</th>
              <th>SOAT</th>
              <th>Técnico-mecánica</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((v) => (
              <tr key={v.id} className="border-b border-slate-100">
                <td className="py-2 font-mono font-medium">{v.plate}</td>
                <td>{TYPE_LABELS[v.type] ?? v.type}</td>
                <td>{v.capacityKg} kg</td>
                <td>
                  {v.isElectric ? (
                    <span className="text-emerald-600">
                      ⚡ {v.socPercent != null ? `${v.socPercent}% SoC` : "Sí"}
                      {v.nominalRangeKm ? ` · ${v.nominalRangeKm} km` : ""}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{docBadge(v.soatExpiresAt)}</td>
                <td>{docBadge(v.tecnoExpiresAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
