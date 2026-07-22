import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import {
  SERVICE_STOP_TYPES,
  SERVICE_STOP_TYPE_LABELS,
  WEEKDAYS,
  WEEKDAY_LABELS,
  serviceSchema,
  type ServiceInput,
  type ServiceStopType,
  type Weekday,
} from "@moveos/shared";
import { api, ApiError } from "../api";
import { useToast } from "../toast";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  Loading,
  PillToggle,
  inputClass,
  tableRowClass,
  theadRowClass,
} from "../components/ui";

/**
 * Controles › Servicios (D3, revamp 6b): catálogo de promesas de entrega. Cada
 * Service tiene nombre, identificador, precio por parada y plazo (SLA en
 * minutos); opcionalmente hora de corte, días de servicio y tipo de parada. Es
 * la base del seguimiento de SLA (cockpit + analítica) y de la facturación B2B.
 * Solo ADMIN (el API lo exige); sin pagos → el servicio NO maneja COD.
 *
 * Revamp: plazo SLA en horas legibles ("4 h (240 min)"), precio COP en mono
 * alineado a la derecha, días como pastillas compactas L-D, tipo como pastilla
 * ENT / REC / REC+ENT y fila inactiva atenuada completa.
 */

interface Service {
  id: string;
  name: string;
  identifier: string;
  pricePerStopCop: number;
  completionDeadlineMin: number;
  cutoffTime: string | null;
  serviceDays: string[];
  stopType: string;
  active: boolean;
}

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

/** Letra de cada día para las pastillas compactas (L M X J V S D). */
const WEEKDAY_LETTERS: Record<Weekday, string> = {
  MON: "L",
  TUE: "M",
  WED: "X",
  THU: "J",
  FRI: "V",
  SAT: "S",
  SUN: "D",
};

/** "240" → "4 h"; "90" → "1.5 h" (formato del mock). */
function formatSlaHours(min: number): string {
  const h = Math.round((min / 60) * 10) / 10;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}

/** Pastilla de tipo de parada: ENT (entrega, limón) / REC / REC+ENT (cielo). */
function StopTypePill({ type }: { type: string }) {
  const label =
    type === "DELIVERY" ? "ENT" : type === "PICKUP" ? "REC" : type === "BOTH" ? "REC+ENT" : type;
  const cls = type === "DELIVERY" ? "bg-lima/50 text-navy" : "bg-sky/40 text-navy";
  return (
    <span
      title={SERVICE_STOP_TYPE_LABELS[type as ServiceStopType] ?? type}
      className={`inline-block whitespace-nowrap rounded-full px-2 py-px text-[10.5px] font-bold ${cls}`}
    >
      {label}
    </span>
  );
}

/** Pastillas compactas de días (22×20): navy = día activo, niebla = inactivo. */
function DayPills({ days }: { days: string[] }) {
  if (days.length === WEEKDAYS.length) {
    return <span className="text-[11.5px] text-text-tertiary">Todos</span>;
  }
  return (
    <span className="inline-flex gap-[3px]">
      {WEEKDAYS.map((d) => {
        const on = days.includes(d);
        return (
          <span
            key={d}
            title={WEEKDAY_LABELS[d]}
            className={`inline-flex h-5 w-[22px] items-center justify-center rounded-[5px] text-[10px] font-semibold ${
              on ? "bg-navy text-white" : "bg-niebla text-sky"
            }`}
          >
            {WEEKDAY_LETTERS[d]}
          </span>
        );
      })}
    </span>
  );
}

type FormState = {
  name: string;
  identifier: string;
  pricePerStopCop: string;
  completionDeadlineMin: string;
  cutoffTime: string;
  serviceDays: Weekday[];
  stopType: ServiceStopType;
  active: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  identifier: "",
  pricePerStopCop: "0",
  completionDeadlineMin: "240",
  cutoffTime: "",
  serviceDays: [...WEEKDAYS],
  stopType: "DELIVERY",
  active: true,
};

export default function ControlesServicios() {
  const toast = useToast();
  const [services, setServices] = useState<Service[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  async function load() {
    setError(null);
    try {
      setServices(await api<Service[]>("GET", "/services"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los servicios.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }
  function openEdit(s: Service) {
    setEditingId(s.id);
    setForm({
      name: s.name,
      identifier: s.identifier,
      pricePerStopCop: String(s.pricePerStopCop),
      completionDeadlineMin: String(s.completionDeadlineMin),
      cutoffTime: s.cutoffTime ?? "",
      serviceDays: (s.serviceDays as Weekday[]).filter((d) => WEEKDAYS.includes(d)),
      stopType: (SERVICE_STOP_TYPES as readonly string[]).includes(s.stopType)
        ? (s.stopType as ServiceStopType)
        : "DELIVERY",
      active: s.active,
    });
    setShowForm(true);
  }
  function toggleDay(day: Weekday) {
    setForm((f) => ({
      ...f,
      serviceDays: f.serviceDays.includes(day)
        ? f.serviceDays.filter((d) => d !== day)
        : [...f.serviceDays, day],
    }));
  }

  async function save() {
    // Validación con el esquema compartido (mismo que aplica el servidor).
    const candidate: ServiceInput = {
      name: form.name.trim(),
      identifier: form.identifier.trim(),
      pricePerStopCop: Number(form.pricePerStopCop) || 0,
      completionDeadlineMin: Number(form.completionDeadlineMin),
      cutoffTime: form.cutoffTime || undefined,
      serviceDays: form.serviceDays,
      stopType: form.stopType,
      active: form.active,
    };
    const parsed = serviceSchema.safeParse(candidate);
    if (!parsed.success) {
      toast.error(new Error(parsed.error.issues[0]?.message ?? "Datos inválidos"));
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await api("PATCH", `/services/${editingId}`, parsed.data);
        toast.success("Servicio actualizado.");
      } else {
        await api("POST", "/services", parsed.data);
        toast.success("Servicio creado.");
      }
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      // El 409 del servidor (identificador duplicado) trae un mensaje útil que
      // el formateador genérico oculta: lo mostramos tal cual.
      if (err instanceof ApiError && err.status === 409) {
        toast.error(new Error("Ya existe un servicio con ese identificador."));
      } else {
        toast.error(err, { retry: () => void save() });
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove(s: Service) {
    if (!window.confirm(`¿Eliminar el servicio "${s.name}"?`)) return;
    try {
      await api("DELETE", `/services/${s.id}`);
      toast.success("Servicio eliminado.");
      await load();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-navy">Servicios</h1>
          <p className="mt-0.5 max-w-2xl text-[12.5px] text-text-secondary">
            Promesas de entrega: precio por parada + plazo SLA · alimentan el cockpit y el
            informe por cliente
          </p>
        </div>
        <Button variant="cta" icon={<Plus strokeWidth={2} />} onClick={openCreate}>
          Nuevo servicio
        </Button>
      </div>

      {error && (
        <Banner kind="error" onDismiss={() => void load()}>
          {error} — toca para reintentar.
        </Banner>
      )}

      {showForm && (
        <Card title={editingId ? "Editar servicio" : "Nuevo servicio"}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nombre (p. ej. Mismo día)">
              <input
                className={inputClass}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                maxLength={80}
              />
            </Field>
            <Field label="Identificador (p. ej. SD)">
              <input
                className={inputClass}
                value={form.identifier}
                onChange={(e) => setForm((f) => ({ ...f, identifier: e.target.value }))}
                maxLength={40}
              />
            </Field>
            <Field label="Precio por parada (COP)">
              <input
                type="number"
                min="0"
                step="100"
                className={inputClass}
                value={form.pricePerStopCop}
                onChange={(e) => setForm((f) => ({ ...f, pricePerStopCop: e.target.value }))}
              />
            </Field>
            <Field label="Plazo de cumplimiento (minutos)">
              <input
                type="number"
                min="1"
                step="15"
                className={inputClass}
                value={form.completionDeadlineMin}
                onChange={(e) =>
                  setForm((f) => ({ ...f, completionDeadlineMin: e.target.value }))
                }
              />
            </Field>
            <Field label="Hora de corte (opcional, America/Bogotá)">
              <input
                type="time"
                className={inputClass}
                value={form.cutoffTime}
                onChange={(e) => setForm((f) => ({ ...f, cutoffTime: e.target.value }))}
              />
            </Field>
            <Field label="Tipo de parada">
              <select
                className={inputClass}
                value={form.stopType}
                onChange={(e) =>
                  setForm((f) => ({ ...f, stopType: e.target.value as ServiceStopType }))
                }
              >
                {SERVICE_STOP_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {SERVICE_STOP_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            <div className="sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium text-text-secondary">
                Días de servicio
              </span>
              <div className="flex flex-wrap gap-1">
                {WEEKDAYS.map((d) => {
                  const on = form.serviceDays.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      aria-label={WEEKDAY_LABELS[d]}
                      title={WEEKDAY_LABELS[d]}
                      onClick={() => toggleDay(d)}
                      className={`inline-flex h-7 w-8 items-center justify-center rounded-[5px] text-[11px] font-semibold transition duration-200 ease-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${
                        on ? "bg-navy text-white" : "bg-niebla text-text-tertiary hover:bg-cielo/40"
                      }`}
                    >
                      {WEEKDAY_LETTERS[d]}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-navy">
              <PillToggle
                checked={form.active}
                onChange={(next) => setForm((f) => ({ ...f, active: next }))}
                label="Servicio activo"
              />
              Servicio activo
            </div>
            <div className="sm:col-span-2 flex gap-2">
              <Button variant="cta" onClick={save} disabled={saving}>
                {saving ? "Guardando…" : editingId ? "Guardar cambios" : "Crear servicio"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </Card>
      )}

      <div className="rounded-lg border border-border bg-surface p-4 shadow-soft">
        {services === null ? (
          <Loading label="Cargando servicios…" />
        ) : services.length === 0 ? (
          <EmptyState
            phrase="Promesas claras, clientes tranquilos."
            action={<Button onClick={openCreate}>Crear servicio</Button>}
          >
            Aún no hay servicios. Crea el primero para empezar a medir el SLA.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[13px] text-navy">
              <thead>
                <tr className={theadRowClass}>
                  <th className="py-1.5 font-semibold">Servicio</th>
                  <th className="w-[130px] py-1.5 pr-5 text-right font-semibold">
                    Precio/parada
                  </th>
                  <th className="w-[150px] py-1.5 font-semibold">Plazo SLA</th>
                  <th className="w-[90px] py-1.5 font-semibold">Corte</th>
                  <th className="w-[110px] py-1.5 font-semibold">Tipo</th>
                  <th className="w-[200px] py-1.5 font-semibold">Días</th>
                  <th className="w-[90px] py-1.5 font-semibold">Estado</th>
                  <th className="w-[110px] py-1.5" />
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.id} className={`${tableRowClass} ${s.active ? "" : "opacity-50"}`}>
                    <td className="py-2.5 pr-3">
                      <span className="font-semibold">{s.name}</span>
                      <span className="block font-mono text-[11px] text-text-tertiary">
                        {s.identifier}
                      </span>
                    </td>
                    <td className="py-2.5 pr-5 text-right font-mono text-[12.5px]">
                      {COP.format(s.pricePerStopCop)}
                    </td>
                    <td className="py-2.5">
                      <span className="font-medium">
                        {formatSlaHours(s.completionDeadlineMin)}
                      </span>{" "}
                      <span className="text-[11px] text-text-tertiary">
                        ({s.completionDeadlineMin} min)
                      </span>
                    </td>
                    <td className="py-2.5 font-mono text-xs">{s.cutoffTime ?? "—"}</td>
                    <td className="py-2.5">
                      <StopTypePill type={s.stopType} />
                    </td>
                    <td className="py-2.5">
                      <DayPills days={s.serviceDays} />
                    </td>
                    <td className="py-2.5">
                      <span
                        className={`inline-block whitespace-nowrap rounded-full px-2 py-px text-[11px] font-semibold ${
                          s.active ? "bg-lima/45 text-lime-ink" : "bg-niebla text-text-tertiary"
                        }`}
                      >
                        {s.active ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="secondary" onClick={() => openEdit(s)}>
                          Editar
                        </Button>
                        <button
                          onClick={() => void remove(s)}
                          className="rounded px-1 text-xs font-medium text-danger transition hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
