import { useEffect, useState } from "react";
import { SERVICE_STOP_TYPES } from "@moveos/shared";
import { api } from "../api";
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
  tableRowClass,
  theadRowClass,
} from "../components/ui";
import { formatCop } from "../format";

interface Service {
  id: string;
  name: string;
  identifier: string;
  pricePerStopCop: number;
  completionDeadlineMin: number;
  cutoffTime: string | null;
  stopType: string;
  active: boolean;
}

const STOP_TYPE_LABELS: Record<string, string> = {
  DELIVERY: "Entrega",
  PICKUP: "Recogida",
  BOTH: "Ambas",
};

const emptyForm = {
  name: "",
  identifier: "",
  pricePerStopCop: "",
  completionDeadlineMin: "",
  cutoffTime: "",
  stopType: "DELIVERY",
};

/**
 * Controles › Servicios (D3): catálogo de promesas de entrega (precio por parada
 * + plazo SLA). Base de facturación y del seguimiento de incumplimientos
 * (SLA_BREACH en Excepciones). Solo ADMIN puede crear/editar. Sin pagos → sin COD.
 */
export default function Servicios() {
  const toast = useToast();
  const [services, setServices] = useState<Service[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
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

  async function create() {
    setSaving(true);
    try {
      await api("POST", "/services", {
        name: form.name.trim(),
        identifier: form.identifier.trim(),
        pricePerStopCop: Number(form.pricePerStopCop) || 0,
        completionDeadlineMin: Number(form.completionDeadlineMin),
        cutoffTime: form.cutoffTime || undefined,
        stopType: form.stopType,
      });
      toast.success("Servicio creado.");
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (err) {
      toast.error(err, { retry: () => void create() });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(s: Service) {
    try {
      await api("PATCH", `/services/${s.id}`, { active: !s.active });
      await load();
    } catch (err) {
      toast.error(err);
    }
  }

  async function remove(s: Service) {
    if (!confirm(`¿Eliminar el servicio "${s.name}"?`)) return;
    try {
      await api("DELETE", `/services/${s.id}`);
      toast.success("Servicio eliminado.");
      await load();
    } catch (err) {
      toast.error(err);
    }
  }

  const canSave =
    form.name.trim() && form.identifier.trim() && Number(form.completionDeadlineMin) > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Servicios"
        subtitle="Promesas de entrega con precio por parada y plazo (SLA). El SLA alimenta el seguimiento de incumplimientos en Excepciones."
        actions={
          <Button variant="cta" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancelar" : "Nuevo servicio"}
          </Button>
        }
      />

      {showForm && (
        <Card title="Nuevo servicio">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre">
              <input
                className={inputClass}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Same Day"
              />
            </Field>
            <Field label="Identificador">
              <input
                className={inputClass}
                value={form.identifier}
                onChange={(e) => setForm({ ...form, identifier: e.target.value })}
                placeholder="SAME_DAY"
              />
            </Field>
            <Field label="Precio por parada (COP)">
              <input
                className={inputClass}
                inputMode="numeric"
                value={form.pricePerStopCop}
                onChange={(e) => setForm({ ...form, pricePerStopCop: e.target.value })}
                placeholder="8000"
              />
            </Field>
            <Field label="Plazo de cumplimiento (min)">
              <input
                className={inputClass}
                inputMode="numeric"
                value={form.completionDeadlineMin}
                onChange={(e) =>
                  setForm({ ...form, completionDeadlineMin: e.target.value })
                }
                placeholder="480"
              />
            </Field>
            <Field label="Hora de corte (opcional)">
              <input
                className={inputClass}
                type="time"
                value={form.cutoffTime}
                onChange={(e) => setForm({ ...form, cutoffTime: e.target.value })}
              />
            </Field>
            <Field label="Tipo de parada">
              <select
                className={inputClass}
                value={form.stopType}
                onChange={(e) => setForm({ ...form, stopType: e.target.value })}
              >
                {SERVICE_STOP_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {STOP_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="mt-3 flex justify-end">
            <Button onClick={create} disabled={saving || !canSave}>
              {saving ? "Guardando…" : "Crear servicio"}
            </Button>
          </div>
        </Card>
      )}

      {error ? (
        <Banner kind="error" onDismiss={() => void load()}>
          {error} — toca para reintentar.
        </Banner>
      ) : services === null ? (
        <Loading label="Cargando servicios…" />
      ) : services.length === 0 ? (
        <Card>
          <EmptyState
            phrase="Última milla con máxima eficiencia."
            action={
              <Button variant="cta" onClick={() => setShowForm(true)}>
                Nuevo servicio
              </Button>
            }
          >
            Aún no hay servicios. Crea el primero para fijar precio y SLA.
          </EmptyState>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={theadRowClass}>
                  <th className="py-2 pr-4 font-medium">Servicio</th>
                  <th className="py-2 pr-4 font-medium">ID</th>
                  <th className="py-2 pr-4 font-medium">Precio/parada</th>
                  <th className="py-2 pr-4 font-medium">SLA (min)</th>
                  <th className="py-2 pr-4 font-medium">Corte</th>
                  <th className="py-2 pr-4 font-medium">Tipo</th>
                  <th className="py-2 pr-4 font-medium">Estado</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.id} className={tableRowClass}>
                    <td className="py-2 pr-4 font-medium text-navy">{s.name}</td>
                    <td className="py-2 pr-4 text-text-secondary">{s.identifier}</td>
                    <td className="py-2 pr-4">{formatCop(s.pricePerStopCop)}</td>
                    <td className="py-2 pr-4">{s.completionDeadlineMin}</td>
                    <td className="py-2 pr-4">{s.cutoffTime ?? "—"}</td>
                    <td className="py-2 pr-4">{STOP_TYPE_LABELS[s.stopType] ?? s.stopType}</td>
                    <td className="py-2 pr-4">
                      <button onClick={() => void toggleActive(s)} title="Cambiar estado">
                        <Badge tone={s.active ? "success" : "neutral"}>
                          {s.active ? "Activo" : "Inactivo"}
                        </Badge>
                      </button>
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => void remove(s)}
                        className="text-xs font-medium text-danger hover:underline"
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
