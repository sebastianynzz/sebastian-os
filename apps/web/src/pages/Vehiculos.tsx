import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  VEHICLE_STATUSES,
  VEHICLE_TYPES,
  VEHICLE_TYPE_PROFILES,
  formatDateBogota,
  type VehicleStatus,
  type VehicleType,
} from "@moveos/shared";
import { Plus, Snowflake, TriangleAlert, Zap } from "lucide-react";
import { api } from "../api";
import { useToast } from "../toast";
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  FilterPill,
  KpiCard,
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

/** Punto de color del estado (patrón del select inline del revamp). */
const STATUS_DOT: Record<string, string> = {
  ACTIVE: "bg-olive",
  CHARGING: "bg-info",
  MAINTENANCE: "bg-warning",
};

/** Descriptor corto de la carrocería, bajo el nombre de la configuración. */
const BODY_LABEL: Record<string, string> = {
  CLOSED_BOX: "caja cerrada",
  REFRIGERATED_BOX: "caja refrigerada",
  OPEN_FLATBED: "plataforma abierta",
};

/** Días (enteros) hasta el vencimiento de un documento; negativo = vencido. */
function docDays(dateStr: string): number {
  return Math.floor((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

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

/** Badge semaforizado del documento, con la fecha en monoespaciado. */
function DocBadge({ dateStr, feminine }: { dateStr: string | null; feminine?: boolean }) {
  if (!dateStr) return <span className="text-text-tertiary">—</span>;
  const days = docDays(dateStr);
  const badge =
    days < 0
      ? { label: feminine ? "Vencida" : "Vencido", tone: "danger" as const }
      : days === 0
        ? { label: "Vence hoy", tone: "warning" as const }
        : days < 30
          ? { label: `${days} día${days === 1 ? "" : "s"}`, tone: "warning" as const }
          : { label: "Vigente", tone: "success" as const };
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <Badge tone={badge.tone}>{badge.label}</Badge>
      <span className="font-mono text-[10.5px] text-text-tertiary">
        {formatDateBogota(dateStr)}
      </span>
    </span>
  );
}

/** SoC como barra (consistente con las demás páginas de flota). */
function SocBar({ soc, kwh }: { soc: number | null; kwh: number | null }) {
  if (soc == null) {
    return (
      <span className="font-mono text-xs text-text-secondary">
        {kwh != null ? `${kwh} kWh` : "—"}
      </span>
    );
  }
  const pct = Math.max(0, Math.min(100, soc));
  const fill = pct < 20 ? "bg-danger" : pct < 40 ? "bg-warning" : "bg-verde";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        role="img"
        aria-label={`Carga ${soc}%`}
        className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-canvas"
      >
        <span className={`block h-full ${fill}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="font-mono text-xs font-semibold text-asfalto">{soc}%</span>
      {kwh != null && (
        <span className="whitespace-nowrap text-[11px] text-text-tertiary">· {kwh} kWh</span>
      )}
    </span>
  );
}

/** Detalle en español de los documentos en riesgo, para el banner. */
function docRiskDetail(v: Vehicle): string {
  const parts: string[] = [];
  if (v.soatExpiresAt && docFlagged(v.soatExpiresAt)) {
    const d = docDays(v.soatExpiresAt);
    parts.push(
      d < 0
        ? `SOAT vencido hace ${-d} día${d === -1 ? "" : "s"}`
        : d === 0
          ? "SOAT vence hoy"
          : `SOAT vence en ${d} día${d === 1 ? "" : "s"}`,
    );
  }
  if (v.tecnoExpiresAt && docFlagged(v.tecnoExpiresAt)) {
    const d = docDays(v.tecnoExpiresAt);
    parts.push(
      d < 0
        ? `técnico-mecánica vencida hace ${-d} día${d === -1 ? "" : "s"}`
        : d === 0
          ? "técnico-mecánica vence hoy"
          : `técnico-mecánica vence en ${d} día${d === 1 ? "" : "s"}`,
    );
  }
  return parts.join(" y ");
}

type Filter = "ALL" | VehicleStatus | "RISK";

export default function Vehiculos() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Depósito base del vehículo (multi-depot, D4 fast-follow).
  const [depots, setDepots] = useState<{ id: string; name: string }[]>([]);
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
    void api<{ id: string; name: string }[]>("GET", "/depots")
      .then(setDepots)
      .catch(() => {});
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

  // Recordatorio de cumplimiento: SOAT o técnico-mecánica vencidos/por vencer.
  const docAlerts = useMemo(
    () => vehicles.filter((v) => docFlagged(v.soatExpiresAt) || docFlagged(v.tecnoExpiresAt)),
    [vehicles],
  );

  const counts = useMemo(
    () => ({
      ACTIVE: vehicles.filter((v) => v.status === "ACTIVE").length,
      CHARGING: vehicles.filter((v) => v.status === "CHARGING").length,
      MAINTENANCE: vehicles.filter((v) => v.status === "MAINTENANCE").length,
    }),
    [vehicles],
  );

  const shown = useMemo(
    () =>
      vehicles.filter((v) => {
        if (filter === "RISK")
          return docFlagged(v.soatExpiresAt) || docFlagged(v.tecnoExpiresAt);
        return filter === "ALL" || v.status === filter;
      }),
    [vehicles, filter],
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
        homeDepotId: data.get("homeDepotId") || undefined,
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
          <Button
            onClick={() => setShowForm((v) => !v)}
            icon={showForm ? undefined : <Plus strokeWidth={2} />}
          >
            {showForm ? "Cancelar" : "Nuevo vehículo"}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Activos" value={counts.ACTIVE} accent />
        <KpiCard label="Cargando" value={counts.CHARGING} />
        <KpiCard
          label="Mantenimiento"
          value={<span className="text-warning">{counts.MAINTENANCE}</span>}
        />
        <KpiCard
          label="Docs en riesgo"
          value={
            <span className={filter === "RISK" ? undefined : "text-danger"}>
              {docAlerts.length}
            </span>
          }
          active={filter === "RISK"}
          onClick={() => setFilter(filter === "RISK" ? "ALL" : "RISK")}
        />
      </div>

      {docAlerts.length > 0 && (
        <div
          role="alert"
          className="flex items-center gap-2.5 rounded-lg border border-danger/30 bg-danger-bg px-3.5 py-2 text-[12.5px] text-danger"
        >
          <TriangleAlert aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2} />
          <span>
            {docAlerts.map((v, i) => (
              <span key={v.id}>
                {i > 0 && " · "}
                <strong className="font-mono">{v.plate}</strong>: {docRiskDetail(v)}
              </span>
            ))}
            . Renueva antes de despacharlos.
          </span>
          <button
            onClick={() => setFilter("RISK")}
            className="ml-auto whitespace-nowrap text-xs font-semibold text-danger underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
          >
            Ver solo en riesgo →
          </button>
        </div>
      )}

      {showForm && (
        <Card title="Nuevo vehículo">
          <form onSubmit={onCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Placa">
              <input
                name="plate"
                className={`${inputClass} font-mono`}
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

            <div className="flex items-center gap-2 rounded-lg bg-success-bg px-3 py-2 text-sm text-success sm:col-span-3">
              <Zap
                aria-hidden="true"
                className="h-4 w-4 shrink-0"
                strokeWidth={2}
                fill="currentColor"
              />
              <span>
                Vehículo 100% eléctrico — exento de pico y placa (Ley 1964/2019).
                Autonomía nominal: <strong>{batteryOption.rangeKm} km</strong>.
              </span>
            </div>

            {/* Cold Box: configuración de zona refrigerada (solo lectura). */}
            {profile.reefer && (
              <div className="flex items-center gap-2 rounded-lg border border-gris-senal/40 bg-info-bg px-3 py-2 text-sm text-info sm:col-span-3">
                <Snowflake aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2} />
                <span>
                  Caja refrigerada <strong>{profile.reefer.unit}</strong> —{" "}
                  {profile.reefer.tempMinC}°C a {profile.reefer.tempMaxC}°C. Perfiles
                  soportados: {profile.reefer.modes.join(", ")}.
                </span>
              </div>
            )}

            {isFlatbed && (
              <div className="rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning sm:col-span-3">
                Plataforma abierta — se carga por peso y área (sin volumen
                cerrado). Ideal para carga voluminosa o irregular.
              </div>
            )}

            {depots.length > 0 && (
              <Field label="Depósito base (opcional)">
                <select name="homeDepotId" className={inputClass} defaultValue="">
                  <option value="">— Sin depósito —</option>
                  {depots.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <div className="sm:col-span-3">
              <Button type="submit" disabled={submitting}>
                {submitting ? "Creando…" : "Crear vehículo"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <div className="mb-3 flex flex-wrap gap-1.5">
          <FilterPill
            active={filter === "ALL"}
            onClick={() => setFilter("ALL")}
            count={vehicles.length}
          >
            Todos
          </FilterPill>
          {VEHICLE_STATUSES.map((s) => (
            <FilterPill
              key={s}
              active={filter === s}
              onClick={() => setFilter(s)}
              count={counts[s]}
            >
              {STATUS_LABEL[s] ?? s}
            </FilterPill>
          ))}
          {docAlerts.length > 0 && (
            <FilterPill
              active={filter === "RISK"}
              onClick={() => setFilter("RISK")}
              count={docAlerts.length}
            >
              En riesgo
            </FilterPill>
          )}
        </div>

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
                  <th className="py-2">Vehículo</th>
                  <th>Configuración</th>
                  <th>Capacidad</th>
                  <th>Batería</th>
                  <th>Cadena de frío</th>
                  <th>SOAT</th>
                  <th>Técnico-mecánica</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((v) => {
                  const p = VEHICLE_TYPE_PROFILES[v.type as VehicleType];
                  const atRisk =
                    docFlagged(v.soatExpiresAt) || docFlagged(v.tecnoExpiresAt);
                  return (
                    <tr
                      key={v.id}
                      className={`${tableRowClass} ${atRisk ? "bg-danger-bg/40" : ""}`}
                    >
                      <td
                        className={`py-2 ${atRisk ? "border-l-[3px] border-l-danger pl-1" : ""}`}
                      >
                        <span className="block font-mono text-[13px] font-bold text-asfalto">
                          {v.plate}
                        </span>
                        {v.nominalRangeKm != null && (
                          <span className="block text-[11px] text-text-tertiary">
                            Autonomía {v.nominalRangeKm} km
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="block font-medium">{typeLabel(v.type)}</span>
                        {p && (
                          <span className="block text-[11px] text-text-tertiary">
                            {BODY_LABEL[p.body] ?? p.body}
                          </span>
                        )}
                      </td>
                      <td className="text-[12.5px]">
                        {v.capacityKg} kg
                        {v.capacityM3 != null ? ` · ${v.capacityM3} m³` : ""}
                      </td>
                      <td>
                        <SocBar soc={v.socPercent} kwh={v.batteryKwh} />
                      </td>
                      <td>
                        {p?.reefer ? (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-info-bg px-2 py-0.5 text-[10.5px] font-semibold text-info">
                            <Snowflake
                              aria-hidden="true"
                              className="h-2.5 w-2.5"
                              strokeWidth={2}
                            />
                            {p.reefer.modes.join("/")}
                          </span>
                        ) : (
                          <span className="text-text-tertiary">—</span>
                        )}
                      </td>
                      <td>
                        <DocBadge dateStr={v.soatExpiresAt} />
                      </td>
                      <td>
                        <DocBadge dateStr={v.tecnoExpiresAt} feminine />
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            aria-hidden="true"
                            className={`h-[7px] w-[7px] shrink-0 rounded-full ${STATUS_DOT[v.status] ?? "bg-border-strong"}`}
                          />
                          <select
                            aria-label={`Estado de ${v.plate}`}
                            className="rounded-md border border-border-strong bg-surface px-2 py-1 text-xs text-asfalto focus:border-asfalto focus:outline-none focus:ring-2 focus:ring-asfalto/25 disabled:opacity-50"
                            value={v.status}
                            disabled={busyId === v.id}
                            onChange={(e) => void patchVehicle(v.id, { status: e.target.value })}
                          >
                            {VEHICLE_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {STATUS_LABEL[s] ?? s}
                              </option>
                            ))}
                          </select>
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-text-tertiary">
                      Ningún vehículo en estado «
                      {filter === "ALL"
                        ? "—"
                        : filter === "RISK"
                          ? "en riesgo"
                          : (STATUS_LABEL[filter] ?? filter)}
                      ».
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-text-tertiary">
              <Zap
                aria-hidden="true"
                className="h-3 w-3 shrink-0 text-asfalto"
                strokeWidth={1}
                fill="currentColor"
              />
              Flota 100% eléctrica — exenta de pico y placa (Ley 1964/2019). La
              configuración define capacidad, pack de batería y autonomía nominal
              desde el catálogo.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
