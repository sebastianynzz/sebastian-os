import { useEffect, useState } from "react";
import { depotSchema, type DepotInput } from "@moveos/shared";
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
} from "../components/ui";

/**
 * Controles › Depósitos (D4 multi-depot): catálogo de centros de salida y
 * regreso de las rutas. El planificador elige el depósito al generar un plan y
 * el optimizador regresa a ese punto. `isMain` marca el principal (uno por
 * tenant). Solo ADMIN (el API lo exige); núcleo, sin gating.
 */

interface Depot {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  isMain: boolean;
}

type FormState = {
  name: string;
  address: string;
  lat: string;
  lng: string;
  isMain: boolean;
};

const EMPTY_FORM: FormState = { name: "", address: "", lat: "", lng: "", isMain: false };

export default function ControlesDepots() {
  const toast = useToast();
  const [depots, setDepots] = useState<Depot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  async function load() {
    setError(null);
    try {
      setDepots(await api<Depot[]>("GET", "/depots"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los depósitos.");
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
  function openEdit(d: Depot) {
    setEditingId(d.id);
    setForm({
      name: d.name,
      address: d.address ?? "",
      lat: String(d.lat),
      lng: String(d.lng),
      isMain: d.isMain,
    });
    setShowForm(true);
  }

  async function save() {
    const candidate: DepotInput = {
      name: form.name.trim(),
      address: form.address.trim() || undefined,
      lat: Number(form.lat),
      lng: Number(form.lng),
      isMain: form.isMain,
    };
    const parsed = depotSchema.safeParse(candidate);
    if (!parsed.success) {
      toast.error(new Error(parsed.error.issues[0]?.message ?? "Datos inválidos"));
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await api("PATCH", `/depots/${editingId}`, parsed.data);
        toast.success("Depósito actualizado.");
      } else {
        await api("POST", "/depots", parsed.data);
        toast.success("Depósito creado.");
      }
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      toast.error(err, { retry: () => void save() });
    } finally {
      setSaving(false);
    }
  }

  async function remove(d: Depot) {
    if (!window.confirm(`¿Eliminar el depósito "${d.name}"?`)) return;
    try {
      await api("DELETE", `/depots/${d.id}`);
      toast.success("Depósito eliminado.");
      await load();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Depósitos"
        subtitle="Centros de salida y regreso de las rutas. El planificador elige el depósito al generar un plan; el optimizador regresa a ese punto. El principal se usa por defecto."
        actions={
          <Button variant="cta" onClick={openCreate}>
            Nuevo depósito
          </Button>
        }
      />

      {error && (
        <Banner kind="error" onDismiss={() => void load()}>
          {error} — toca para reintentar.
        </Banner>
      )}

      {showForm && (
        <Card title={editingId ? "Editar depósito" : "Nuevo depósito"}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nombre (p. ej. Central)">
              <input
                className={inputClass}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                maxLength={80}
              />
            </Field>
            <Field label="Dirección (opcional)">
              <input
                className={inputClass}
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                maxLength={200}
              />
            </Field>
            <Field label="Latitud">
              <input
                type="number"
                step="0.000001"
                className={inputClass}
                value={form.lat}
                onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))}
                placeholder="4.6486"
              />
            </Field>
            <Field label="Longitud">
              <input
                type="number"
                step="0.000001"
                className={inputClass}
                value={form.lng}
                onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))}
                placeholder="-74.0628"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-navy/80">
              <input
                type="checkbox"
                checked={form.isMain}
                onChange={(e) => setForm((f) => ({ ...f, isMain: e.target.checked }))}
              />
              Depósito principal
            </label>
            <div className="sm:col-span-2 flex gap-2">
              <Button variant="cta" onClick={save} disabled={saving}>
                {saving ? "Guardando…" : editingId ? "Guardar cambios" : "Crear depósito"}
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
        {depots === null ? (
          <Loading label="Cargando depósitos…" />
        ) : depots.length === 0 ? (
          <EmptyState
            phrase="Tu red, lista para crecer."
            action={<Button onClick={openCreate}>Crear depósito</Button>}
          >
            Aún no hay depósitos. Crea el primero (será el principal).
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-secondary">
                  <th className="py-2 pr-4 font-medium">Depósito</th>
                  <th className="py-2 pr-4 font-medium">Dirección</th>
                  <th className="py-2 pr-4 font-medium">Coordenadas</th>
                  <th className="py-2 pr-4 font-medium">Principal</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {depots.map((d) => (
                  <tr key={d.id} className="border-b border-border/60">
                    <td className="py-2 pr-4 font-medium text-navy">{d.name}</td>
                    <td className="py-2 pr-4 text-navy/70">{d.address ?? "—"}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-navy/60">
                      {d.lat.toFixed(5)}, {d.lng.toFixed(5)}
                    </td>
                    <td className="py-2 pr-4">
                      {d.isMain ? <Badge tone="success">Principal</Badge> : <span className="text-navy/40">—</span>}
                    </td>
                    <td className="py-2">
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" onClick={() => openEdit(d)}>
                          Editar
                        </Button>
                        <button
                          onClick={() => void remove(d)}
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
