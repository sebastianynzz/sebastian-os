import { useEffect, useState } from "react";
import { Pencil, Plus, Rows3, Trash2 } from "lucide-react";
import {
  customPropertySchema,
  type CustomPropertyInput,
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
  tableRowClass,
  theadRowClass,
} from "../components/ui";

/* Botón fantasma de peligro (reemplaza el enlace de texto rojo). */
const dangerGhostClass =
  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-danger transition duration-200 ease-brand hover:bg-danger-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger";

/**
 * Controles › Campos personalizados (Tier 2 §9): el operador define campos
 * extra por pedido (p. ej. "Piso", "# factura") y decide, por campo, si lo ve
 * el CONDUCTOR (app) y/o el DESTINATARIO (página pública de rastreo, B2B). El
 * número de campos se limita por plan, con aviso de upsell. Solo ADMIN.
 */

interface CustomProperty {
  id: string;
  name: string;
  visibleToDriver: boolean;
  visibleToRecipient: boolean;
}

interface CustomPropertiesResponse {
  items: CustomProperty[];
  cap: number;
  used: number;
  plan: string;
}

type FormState = {
  name: string;
  visibleToDriver: boolean;
  visibleToRecipient: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  visibleToDriver: false,
  visibleToRecipient: false,
};

export default function ControlesCampos() {
  const toast = useToast();
  const [data, setData] = useState<CustomPropertiesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  async function load() {
    setError(null);
    try {
      setData(await api<CustomPropertiesResponse>("GET", "/custom-properties"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los campos.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const atCap = data !== null && data.used >= data.cap;

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }
  function openEdit(p: CustomProperty) {
    setEditingId(p.id);
    setForm({
      name: p.name,
      visibleToDriver: p.visibleToDriver,
      visibleToRecipient: p.visibleToRecipient,
    });
    setShowForm(true);
  }

  async function save() {
    const candidate: CustomPropertyInput = {
      name: form.name.trim(),
      visibleToDriver: form.visibleToDriver,
      visibleToRecipient: form.visibleToRecipient,
    };
    const parsed = customPropertySchema.safeParse(candidate);
    if (!parsed.success) {
      toast.error(new Error(parsed.error.issues[0]?.message ?? "Datos inválidos"));
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await api("PATCH", `/custom-properties/${editingId}`, parsed.data);
        toast.success("Campo actualizado.");
      } else {
        await api("POST", "/custom-properties", parsed.data);
        toast.success("Campo creado.");
      }
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      // El 409 del tope del plan trae un mensaje de upsell útil: mostrarlo tal cual.
      if (err instanceof ApiError && err.status === 409) {
        toast.error(
          new Error(
            err.message ||
              "Alcanzaste el límite de campos de tu plan. Mejora tu plan para agregar más.",
          ),
        );
      } else {
        toast.error(err, { retry: () => void save() });
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: CustomProperty) {
    if (!window.confirm(`¿Eliminar el campo "${p.name}"?`)) return;
    try {
      await api("DELETE", `/custom-properties/${p.id}`);
      toast.success("Campo eliminado.");
      await load();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Campos personalizados"
        subtitle="Agrega datos extra a cada pedido (p. ej. piso, número de factura) y decide, por campo, si lo ve el conductor en la app y/o el destinatario en la página de rastreo. Se rellenan al crear el pedido, importar CSV o desde el portal."
        actions={
          <Button
            variant="cta"
            icon={<Plus strokeWidth={2} />}
            onClick={openCreate}
            disabled={atCap}
          >
            Nuevo campo
          </Button>
        }
      />

      {error && (
        <Banner kind="error" onDismiss={() => void load()}>
          {error} — toca para reintentar.
        </Banner>
      )}

      {data && (
        <Banner kind={atCap ? "warning" : "info"}>
          {atCap ? (
            <>
              Usaste <strong>{data.used}</strong> de <strong>{data.cap}</strong> campos
              del plan <strong>{data.plan}</strong>. Para agregar más, mejora tu plan.
            </>
          ) : (
            <>
              {data.used} de {data.cap} campos usados (plan {data.plan}).
            </>
          )}
        </Banner>
      )}

      {showForm && (
        <Card title={editingId ? "Editar campo" : "Nuevo campo"}>
          <div className="grid grid-cols-1 gap-4">
            <Field label="Nombre del campo (p. ej. Piso, # factura)">
              <input
                className={inputClass}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                maxLength={60}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-navy/80">
              <input
                type="checkbox"
                className="accent-navy"
                checked={form.visibleToDriver}
                onChange={(e) =>
                  setForm((f) => ({ ...f, visibleToDriver: e.target.checked }))
                }
              />
              Visible para el conductor (app)
            </label>
            <label className="flex items-center gap-2 text-sm text-navy/80">
              <input
                type="checkbox"
                className="accent-navy"
                checked={form.visibleToRecipient}
                onChange={(e) =>
                  setForm((f) => ({ ...f, visibleToRecipient: e.target.checked }))
                }
              />
              Visible para el destinatario (página de rastreo)
            </label>
            <div className="flex gap-2">
              <Button variant="primary" onClick={save} disabled={saving}>
                {saving ? "Guardando…" : editingId ? "Guardar cambios" : "Crear campo"}
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
        {data === null ? (
          <Loading label="Cargando campos…" />
        ) : data.items.length === 0 ? (
          <EmptyState
            icon={<Rows3 aria-hidden="true" className="h-8 w-8" strokeWidth={1.75} />}
            phrase="Cada entrega cuenta su propia historia."
            action={
              <Button onClick={openCreate} icon={<Plus strokeWidth={2} />}>
                Crear campo
              </Button>
            }
          >
            Aún no hay campos personalizados. Crea el primero para capturar datos extra
            en tus pedidos.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={theadRowClass}>
                  <th className="py-2 pr-4 font-medium">Campo</th>
                  <th className="py-2 pr-4 font-medium">Visibilidad</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id} className={tableRowClass}>
                    <td className="py-2 pr-4 font-medium text-navy">{p.name}</td>
                    <td className="py-2 pr-4">
                      <div className="flex flex-wrap gap-1.5">
                        {p.visibleToDriver && <Badge tone="info">Conductor</Badge>}
                        {p.visibleToRecipient && (
                          <Badge tone="success">Destinatario</Badge>
                        )}
                        {!p.visibleToDriver && !p.visibleToRecipient && (
                          <Badge tone="neutral">Solo interno</Badge>
                        )}
                      </div>
                    </td>
                    <td className="py-2">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          icon={<Pencil strokeWidth={2} />}
                          onClick={() => openEdit(p)}
                        >
                          Editar
                        </Button>
                        <button onClick={() => void remove(p)} className={dangerGhostClass}>
                          <Trash2 aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
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
