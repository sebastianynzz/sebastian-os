import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  Loading,
  PageHeader,
  inputClass,
  tableRowClass,
  theadRowClass,
} from "../components/ui";

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
  if (!dateStr) return <span className="text-navy/40">—</span>;
  const days = Math.floor((new Date(dateStr).getTime() - Date.now()) / 86400000);
  if (days < 0) return <span className="font-medium text-red-600">Vencido</span>;
  if (days < 30)
    return <span className="font-medium text-amber-600">{days} días</span>;
  return <span className="text-emerald-600">Vigente</span>;
}

export default function Vehiculos() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [isElectric, setIsElectric] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setVehicles(await api<Vehicle[]>("GET", "/vehicles"));
    } finally {
      setLoading(false);
    }
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
      <PageHeader
        title="Vehículos"
        actions={
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancelar" : "Nuevo vehículo"}
          </Button>
        }
      />

      {showForm && (
        <Card title="Nuevo vehículo">
          <form onSubmit={onCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
            <label className="flex items-center gap-2 text-sm sm:col-span-3">
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
            {error && (
              <div className="sm:col-span-3">
                <Banner kind="error" onDismiss={() => setError(null)}>
                  {error}
                </Banner>
              </div>
            )}
            <div className="sm:col-span-3">
              <Button type="submit">Crear vehículo</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        {loading ? (
          <Loading label="Cargando vehículos…" />
        ) : (
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className={theadRowClass}>
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
              <tr key={v.id} className={tableRowClass}>
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
            {vehicles.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <EmptyState
                    action={
                      <Button onClick={() => setShowForm(true)}>
                        Nuevo vehículo
                      </Button>
                    }
                  >
                    Aún no hay vehículos registrados.
                  </EmptyState>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        )}
      </Card>
    </div>
  );
}
