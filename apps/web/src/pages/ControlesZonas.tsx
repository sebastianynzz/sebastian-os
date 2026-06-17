import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Polygon, TileLayer, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { zoneSchema, type ZoneInput } from "@moveos/shared";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
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
 * Controles › Zonas de entrega (D5): el ADMIN dibuja polígonos en el mapa
 * (clic para agregar vértices) y les asigna conductores. Base de la verificación
 * de cobertura al crear pedidos (point-in-zone) y de la preferencia de asignación
 * por zona. Solo ADMIN (el API lo exige); núcleo, sin gating.
 */

interface LatLng {
  lat: number;
  lng: number;
}
interface Zone {
  id: string;
  name: string;
  color: string;
  geometry: { points: LatLng[] };
  driverIds: string[];
}
interface DriverOption {
  id: string;
  name: string;
}

// Colores de zona (DATO de la zona, no token de estilo de UI). Paleta distinguible
// en el mapa; el primero es el navy de marca.
const ZONE_PALETTE = ["#233955", "#CFDD80", "#A7B6C4", "#E07A5F", "#3D9970", "#B5179E"];

const BOGOTA: [number, number] = [4.6486, -74.0628];

const markerIcon = new L.Icon({
  iconUrl: markerIconUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

/** Captura clics del mapa para agregar vértices mientras se dibuja. */
function ClickCapture({ active, onAdd }: { active: boolean; onAdd: (p: LatLng) => void }) {
  useMapEvents({
    click(e) {
      if (active) onAdd({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

type FormState = { name: string; color: string; driverIds: string[] };
const EMPTY_FORM: FormState = { name: "", color: ZONE_PALETTE[0]!, driverIds: [] };

export default function ControlesZonas() {
  const toast = useToast();
  const [zones, setZones] = useState<Zone[] | null>(null);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [points, setPoints] = useState<LatLng[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    setError(null);
    try {
      setZones(await api<Zone[]>("GET", "/zones"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar las zonas.");
    }
  }
  useEffect(() => {
    void load();
    void api<DriverOption[]>("GET", "/drivers").then(setDrivers).catch(() => {});
  }, []);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setPoints([]);
    setDrawing(true);
    setShowForm(true);
  }
  function openEdit(z: Zone) {
    setEditingId(z.id);
    setForm({ name: z.name, color: z.color, driverIds: z.driverIds });
    setPoints(z.geometry.points);
    setDrawing(false);
    setShowForm(true);
  }
  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setPoints([]);
    setDrawing(false);
  }

  function toggleDriver(id: string) {
    setForm((f) => ({
      ...f,
      driverIds: f.driverIds.includes(id)
        ? f.driverIds.filter((d) => d !== id)
        : [...f.driverIds, id],
    }));
  }

  async function save() {
    const candidate: ZoneInput = {
      name: form.name.trim(),
      color: form.color,
      geometry: { points },
      driverIds: form.driverIds,
    };
    const parsed = zoneSchema.safeParse(candidate);
    if (!parsed.success) {
      toast.error(
        new Error(
          points.length < 3
            ? "Dibuja al menos 3 vértices en el mapa."
            : parsed.error.issues[0]?.message ?? "Datos inválidos",
        ),
      );
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await api("PATCH", `/zones/${editingId}`, parsed.data);
        toast.success("Zona actualizada.");
      } else {
        await api("POST", "/zones", parsed.data);
        toast.success("Zona creada.");
      }
      closeForm();
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        toast.error(new Error("Revisa el polígono y los conductores asignados."));
      } else {
        toast.error(err, { retry: () => void save() });
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove(z: Zone) {
    if (!window.confirm(`¿Eliminar la zona "${z.name}"?`)) return;
    try {
      await api("DELETE", `/zones/${z.id}`);
      toast.success("Zona eliminada.");
      await load();
    } catch (err) {
      toast.error(err);
    }
  }

  const driverName = useMemo(
    () => new Map(drivers.map((d) => [d.id, d.name])),
    [drivers],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Zonas de entrega"
        subtitle="Dibuja polígonos en el mapa y asígnales conductores. Sirven para verificar la cobertura de un pedido y orientar la asignación por zona."
        actions={
          <Button variant="cta" onClick={openCreate}>
            Nueva zona
          </Button>
        }
      />

      {error && (
        <Banner kind="error" onDismiss={() => void load()}>
          {error} — toca para reintentar.
        </Banner>
      )}

      {showForm && (
        <Card title={editingId ? "Editar zona" : "Nueva zona"}>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-4">
              <Field label="Nombre (p. ej. Centro)">
                <input
                  className={inputClass}
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  maxLength={80}
                />
              </Field>
              <div>
                <span className="mb-1 block text-sm font-medium text-navy/70">Color</span>
                <div className="flex flex-wrap gap-2">
                  {ZONE_PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Color ${c}`}
                      aria-pressed={form.color === c}
                      onClick={() => setForm((f) => ({ ...f, color: c }))}
                      style={{ backgroundColor: c }}
                      className={`h-7 w-7 rounded-full border-2 ${
                        form.color === c ? "border-navy" : "border-transparent"
                      }`}
                    />
                  ))}
                </div>
              </div>
              <div>
                <span className="mb-1 block text-sm font-medium text-navy/70">
                  Conductores de la zona
                </span>
                {drivers.length === 0 ? (
                  <p className="text-xs text-navy/50">No hay conductores registrados.</p>
                ) : (
                  <div className="max-h-32 space-y-1 overflow-y-auto">
                    {drivers.map((d) => (
                      <label key={d.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={form.driverIds.includes(d.id)}
                          onChange={() => toggleDriver(d.id)}
                        />
                        {d.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant={drawing ? "primary" : "secondary"}
                  onClick={() => setDrawing((v) => !v)}
                >
                  {drawing ? "Dibujando… (clic en el mapa)" : "Dibujar / agregar vértices"}
                </Button>
                <button
                  onClick={() => setPoints((p) => p.slice(0, -1))}
                  disabled={points.length === 0}
                  className="text-sm font-medium text-navy underline disabled:opacity-40"
                >
                  Deshacer
                </button>
                <button
                  onClick={() => setPoints([])}
                  disabled={points.length === 0}
                  className="text-sm font-medium text-navy underline disabled:opacity-40"
                >
                  Limpiar
                </button>
                <span className="text-xs text-navy/50">{points.length} vértice(s)</span>
              </div>
              <div className="flex gap-2">
                <Button variant="cta" onClick={save} disabled={saving}>
                  {saving ? "Guardando…" : editingId ? "Guardar cambios" : "Crear zona"}
                </Button>
                <Button variant="secondary" onClick={closeForm}>
                  Cancelar
                </Button>
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border border-border">
              <MapContainer center={BOGOTA} zoom={11} style={{ height: 360 }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <ClickCapture
                  active={drawing}
                  onAdd={(p) => setPoints((prev) => [...prev, p])}
                />
                {/* Zonas existentes como contexto (atenuadas). */}
                {(zones ?? [])
                  .filter((z) => z.id !== editingId)
                  .map((z) => (
                    <Polygon
                      key={z.id}
                      positions={z.geometry.points.map((p) => [p.lat, p.lng])}
                      pathOptions={{ color: z.color, opacity: 0.4, fillOpacity: 0.1 }}
                    />
                  ))}
                {points.length >= 2 && (
                  <Polygon
                    positions={points.map((p) => [p.lat, p.lng])}
                    pathOptions={{ color: form.color, fillOpacity: 0.25 }}
                  />
                )}
                {points.map((p, i) => (
                  <Marker key={i} position={[p.lat, p.lng]} icon={markerIcon} />
                ))}
              </MapContainer>
            </div>
          </div>
        </Card>
      )}

      <Card>
        {zones === null ? (
          <Loading label="Cargando zonas…" />
        ) : zones.length === 0 ? (
          <EmptyState
            phrase="Tu ciudad, organizada."
            action={<Button onClick={openCreate}>Crear zona</Button>}
          >
            Aún no hay zonas. Dibuja la primera en el mapa.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-secondary">
                  <th className="py-2 pr-4 font-medium">Zona</th>
                  <th className="py-2 pr-4 font-medium">Vértices</th>
                  <th className="py-2 pr-4 font-medium">Conductores</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.id} className="border-b border-border/60">
                    <td className="py-2 pr-4">
                      <span className="inline-flex items-center gap-2 font-medium text-navy">
                        <span
                          aria-hidden="true"
                          style={{ backgroundColor: z.color }}
                          className="h-3 w-3 rounded-full"
                        />
                        {z.name}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-navy/60">{z.geometry.points.length}</td>
                    <td className="py-2 pr-4">
                      {z.driverIds.length === 0 ? (
                        <span className="text-navy/40">Sin asignar</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {z.driverIds.map((id) => (
                            <Badge key={id} tone="neutral">
                              {driverName.get(id) ?? id}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="py-2">
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" onClick={() => openEdit(z)}>
                          Editar
                        </Button>
                        <button
                          onClick={() => void remove(z)}
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
