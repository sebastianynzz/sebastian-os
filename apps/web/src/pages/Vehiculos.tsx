import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  VEHICLE_STATUSES,
  VEHICLE_TYPES,
  VEHICLE_TYPE_PROFILES,
  type VehicleStatus,
  type VehicleType,
} from "@moveos/shared";
import { api } from "../api";
import { useToast } from "../toast";
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
  capacityM3: number | null;
  isElectric: boolean;
  batteryKwh: number | null;
  nominalRangeKm: number | null;
  socPercent: number | null;
  status: string;
  soatExpiresAt: string | null;
  tecnoExpiresAt: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Activo",
  MAINTENANCE: "Mantenimiento",
  CHARGING: "Cargando",
};

/** Documento vencido o por vencer (≤30 días): alimenta el recordatorio. */
function docFlagged(dateStr: string | null): boolean {
  if (!dateStr) return false;
  return (new Date(dateStr).getTime() - Date.now()) / 86400000 < 30;
}

/** Etiquetas en español derivadas del catálogo (fuente única de verdad). */
function typeLabel(type: string): string {
  return VEHICLE_TYPE_PROFILES[type as VehicleType]?.labelEs ?? type;
}

/** Defaults de formulario para una configuración (pre-rellenado type-driven). */
function defaultsFor(type: VehicleType) {
  const p = VEHICLE_TYPE_PROFILES[type];
  const battery = p.batteryOptions[0]!;
  return {
    batteryKwh: battery.batteryKwh,
    capacityKg: String(p.payloadKg),
    capacityM3: p.cargoVolumeM3 != null ? String(p.cargoVolumeM3) : "",
  };
}

function docBadge(dateStr: string | null) {
  if (!dateStr) return <span className="text-navy/40">—</span>;
  const days = Math.floor((new Date(dateStr).getTime() - Date.now()) / 86400000);
  if (days < 0) return <span className="font-medium text-danger">Vencido</span>;
  if (days < 30)
    return <span className="font-medium text-warning">{days} días</span>;
  return <span className="text-success">Vigente</span>;
}

export default function Vehiculos() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState<"ALL" | VehicleStatus>("ALL");
  const [busyId, setBusyId] = useState<string | null>(null);
  const toast = useToast();

  // Estado del formulario, dirigido por la configuración seleccionada.
  const [type, setType] = useState<VehicleType>(VEHICLE_TYPES[0]);
  const [batteryKwh, setBatteryKwh] = useState<number>(
    () => defaultsFor(VEHICLE_TYPES[0]).batteryKwh,
  );
  const [capacityKg, setCapacityKg] = useState<string>(
    () => defaultsFor(VEHICLE_TYPES[0]).capacityKg,
  );
  const [capacityM3, setCapacityM3] = useState<string>(
    () => defaultsFor(VEHICLE_TYPES[0]).capacityM3,
  );

  const profile = VEHICLE_TYPE_PROFILES[type];
  const batteryOption =
    profile.batteryOptions.find((o) => o.batteryKwh === batteryKwh) ??
    profile.batteryOptions[0]!;
  const isFlatbed = profile.body === "OPEN_FLATBED";

  function onTypeChange(next: VehicleType) {
    setType(next);
    const d = defaultsFor(next);
    setBatteryKwh(d.batteryKwh);
    setCapacityKg(d.capacityKg);
    setCapacityM3(d.capacityM3);
  }

  function onBatteryChange(kwh: number) {
    setBatteryKwh(kwh);
  }

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      setVehicles(await api<Vehicle[]>("GET", "/vehicles"));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function patchVehicle(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    try {
      await api("PATCH", `/vehicles/${id}`, body);
      await load();
    } catch (err) {
      toast.error(err, { fallback: "No se pudo actualizar el vehículo" });
    } finally {
      setBusyId(null);
    }
  }

  const shown = useMemo(
    () => vehicles.filter((v) => filter === "ALL" || v.status === filter),
    [vehicles, filter],
  );
  // Recordatorio de cumplimiento: SOAT o técnico-mecánica vencidos/por vencer.
  const docAlerts = useMemo(
    () => vehicles.filter((v) => docFlagged(v.soatExpiresAt) || docFlagged(v.tecnoExpiresAt)),
    [vehicles],
  );

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const data = new FormData(e.currentTarget);
    try {
      await api("POST", "/vehicles", {
        plate: String(data.get("plate") ?? "").trim(),
        type,
        capacityKg: Number(capacityKg),
        // Flatbed: sin volumen (se limita por peso/área de plataforma).
        capacityM3: isFlatbed || !capacityM3 ? undefined : Number(capacityM3),
        // Toda la flota MoveOS es eléctrica (restricción dura 1).
        isElectric: true,
        batteryKwh: batteryOption.batteryKwh,
        nominalRangeKm: batteryOption.rangeKm,
      });
      setShowForm(false);
      onTypeChange(VEHICLE_TYPES[0]); // reset
      await load();
    } catch (err) {
      toast.error(err, { fallback: "Error al crear el vehículo" });
    } finally {
      setSubmitting(false);
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
              <input
                name="plate"
                className={inputClass}
                required
                minLength={5}
                maxLength={8}
                placeholder="ABC123 / ABC12D"
              />
            </Field>
            <Field label="Configuración">
              <select
                name="type"
                className={inputClass}
                value={type}
                onChange={(e) => onTypeChange(e.target.value as VehicleType)}
              >
                {VEHICLE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {VEHICLE_TYPE_PROFILES[t].labelEs}
                  </option>
                ))}
              </select>
            </Field>
            {/* IONAx: selector de pack de batería (define autonomía). */}
            {profile.batteryOptions.length > 1 ? (
              <Field label="Pack de batería">
                <select
                  className={inputClass}
                  value={batteryKwh}
                  onChange={(e) => onBatteryChange(Number(e.target.value))}
                >
                  {profile.batteryOptions.map((o) => (
                    <option key={o.batteryKwh} value={o.batteryKwh}>
                      {o.batteryKwh} kWh · {o.rangeKm} km
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="Batería">
                <input
                  className={inputClass}
                  value={`${batteryOption.batteryKwh} kWh · ${batteryOption.rangeKm} km`}
                  readOnly
                  disabled
                />
              </Field>
            )}
            <Field label="Capacidad (kg)">
              <input
                type="number"
                min={1}
                step="1"
                className={inputClass}
                value={capacityKg}
                onChange={(e) => setCapacityKg(e.target.value)}
                required
              />
            </Field>
            {/* Volumen: oculto para flatbed (se limita por peso/área). */}
            {!isFlatbed && (
              <Field label="Volumen (m³)">
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  className={inputClass}
                  value={capacityM3}
                  onChange={(e) => setCapacityM3(e.target.value)}
                />
              </Field>
            )}

            <div className="rounded-lg bg-success-bg px-3 py-2 text-sm text-success sm:col-span-3">
              ⚡ Vehículo 100% eléctrico — exento de pico y placa (Ley 1964/2019).
              Autonomía nominal: <strong>{batteryOption.rangeKm} km</strong>.
            </div>

            {/* Cold Box: configuración de zona refrigerada (solo lectura). */}
            {profile.reefer && (
              <div className="rounded-lg border border-sky/40 bg-sky-50 px-3 py-2 text-sm text-info sm:col-span-3">
                ❄️ Caja refrigerada <strong>{profile.reefer.unit}</strong> —{" "}
                {profile.reefer.tempMinC}°C a {profile.reefer.tempMaxC}°C. Perfiles
                soportados: {profile.reefer.modes.join(", ")}.
              </div>
            )}

            {isFlatbed && (
              <div className="rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning sm:col-span-3">
                Plataforma abierta — se carga por peso y área (sin volumen
                cerrado). Ideal para carga voluminosa o irregular.
              </div>
            )}

            <div className="sm:col-span-3">
              <Button type="submit" disabled={submitting}>
                {submitting ? "Creando…" : "Crear vehículo"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {docAlerts.length > 0 && (
        <Banner kind="error">
          {docAlerts.length} vehículo(s) con SOAT o técnico-mecánica vencido o por
          vencer (≤30 días). Renueva antes de despacharlos.
        </Banner>
      )}

      <Card
        actions={
          <div className="flex flex-wrap gap-1 text-xs">
            {(["ALL", ...VEHICLE_STATUSES] as ("ALL" | VehicleStatus)[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-3 py-1 ${
                  filter === f ? "bg-navy text-white" : "border border-cielo text-navy/70"
                }`}
              >
                {f === "ALL" ? "Todos" : STATUS_LABEL[f]}
              </button>
            ))}
          </div>
        }
      >
        {loading ? (
          <Loading label="Cargando vehículos…" />
        ) : loadError ? (
          <Banner kind="error" onDismiss={() => void load()}>
            {loadError} — toca para reintentar.
          </Banner>
        ) : vehicles.length === 0 ? (
          <EmptyState
            phrase="Potencia tu flota, reduce tus costos."
            action={
              <Button onClick={() => setShowForm(true)}>Nuevo vehículo</Button>
            }
          >
            Aún no hay vehículos registrados.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={theadRowClass}>
                  <th className="py-2">Placa</th>
                  <th>Configuración</th>
                  <th>Estado</th>
                  <th>Capacidad</th>
                  <th>EV</th>
                  <th>Cadena de frío</th>
                  <th>SOAT</th>
                  <th>Técnico-mecánica</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((v) => {
                  const p = VEHICLE_TYPE_PROFILES[v.type as VehicleType];
                  return (
                    <tr key={v.id} className={tableRowClass}>
                      <td className="py-2 font-mono font-medium">{v.plate}</td>
                      <td>{typeLabel(v.type)}</td>
                      <td>
                        <select
                          aria-label={`Estado de ${v.plate}`}
                          className="rounded border border-cielo bg-white px-1.5 py-0.5 text-xs text-navy disabled:opacity-50"
                          value={v.status}
                          disabled={busyId === v.id}
                          onChange={(e) => void patchVehicle(v.id, { status: e.target.value })}
                        >
                          {VEHICLE_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABEL[s]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {v.capacityKg} kg
                        {v.capacityM3 != null ? ` · ${v.capacityM3} m³` : ""}
                      </td>
                      <td>
                        {v.isElectric ? (
                          <span className="text-success">
                            ⚡ {v.socPercent != null ? `${v.socPercent}% SoC` : "Sí"}
                            {v.nominalRangeKm ? ` · ${v.nominalRangeKm} km` : ""}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {p?.reefer ? (
                          <span className="text-info">
                            ❄️ {p.reefer.modes.join("/")}
                          </span>
                        ) : (
                          <span className="text-navy/40">—</span>
                        )}
                      </td>
                      <td>{docBadge(v.soatExpiresAt)}</td>
                      <td>{docBadge(v.tecnoExpiresAt)}</td>
                    </tr>
                  );
                })}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-navy/40">
                      Ningún vehículo en estado «{filter === "ALL" ? "—" : STATUS_LABEL[filter]}».
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
