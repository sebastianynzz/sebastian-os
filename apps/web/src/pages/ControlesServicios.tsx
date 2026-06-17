import { useEffect, useState } from "react";
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
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  Loading,
  PageHeader,
  inputClass,
} from "../components/ui";

/**
 * Controles › Servicios (D3): catálogo de promesas de entrega. Cada Service
 * tiene nombre, identificador, precio por parada y plazo (SLA en minutos);
 * opcionalmente hora de corte, días de servicio y tipo de parada. Es la base
 * del seguimiento de SLA (cockpit + analítica) y de la facturación B2B.
 * Solo ADMIN (el API lo exige); sin pagos → el servicio NO maneja COD.
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
    <div className="space-y-4">
      <PageHeader
        title="Servicios"
        subtitle="Define las promesas de entrega (precio por parada + plazo SLA) que aplicas a cada pedido. El plazo alimenta el cockpit de excepciones y el informe de cumplimiento por cliente."
        actions={
          <Button variant="cta" onClick={openCreate}>
            Nuevo servicio
          </Button>
        }
      />

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
              <span className="mb-1 block text-sm font-medium text-navy/70">
                Días de servicio
              </span>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((d) => {
                  const on = form.serviceDays.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleDay(d)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                        on ? "bg-navy text-white" : "bg-niebla text-navy/70 hover:bg-cielo/40"
                      }`}
                    >
                      {WEEKDAY_LABELS[d]}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-navy/80">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              />
              Servicio activo
            </label>
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

      <Card>
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-secondary">
                  <th className="py-2 pr-4 font-medium">Servicio</th>
                  <th className="py-2 pr-4 font-medium">Precio/parada</th>
                  <th className="py-2 pr-4 font-medium">Plazo SLA</th>
                  <th className="py-2 pr-4 font-medium">Corte</th>
                  <th className="py-2 pr-4 font-medium">Tipo</th>
                  <th className="py-2 pr-4 font-medium">Días</th>
                  <th className="py-2 pr-4 font-medium">Estado</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.id} className="border-b border-border/60">
                    <td className="py-2 pr-4">
                      <div className="font-medium text-navy">{s.name}</div>
                      <div className="font-mono text-xs text-navy/50">{s.identifier}</div>
                    </td>
                    <td className="py-2 pr-4">{COP.format(s.pricePerStopCop)}</td>
                    <td className="py-2 pr-4">{s.completionDeadlineMin} min</td>
                    <td className="py-2 pr-4">{s.cutoffTime ?? "—"}</td>
                    <td className="py-2 pr-4">
                      {SERVICE_STOP_TYPE_LABELS[s.stopType as ServiceStopType] ?? s.stopType}
                    </td>
                    <td className="py-2 pr-4 text-xs text-navy/60">
                      {s.serviceDays.length === WEEKDAYS.length
                        ? "Todos"
                        : s.serviceDays
                            .map((d) => WEEKDAY_LABELS[d as Weekday] ?? d)
                            .join(" ")}
                    </td>
                    <td className="py-2 pr-4">
                      <Badge tone={s.active ? "success" : "neutral"}>
                        {s.active ? "Activo" : "Inactivo"}
                      </Badge>
                    </td>
                    <td className="py-2">
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" onClick={() => openEdit(s)}>
                          Editar
                        </Button>
                        <button
                          onClick={() => void remove(s)}
                          className="rounded-lg px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger-bg"
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
      </Card>
    </div>
  );
}
