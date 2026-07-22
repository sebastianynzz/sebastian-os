import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Polygon, TileLayer, Tooltip, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { Plus, X } from "lucide-react";
import { zoneSchema, type ZoneInput } from "@moveos/shared";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import { api, ApiError } from "../api";
import { useToast } from "../toast";
import {
  Banner,
  Button,
  EmptyState,
  Loading,
  inputClass,
  tableRowClass,
  theadRowClass,
} from "../components/ui";

/**
 * Controles › Zonas de entrega (D5, revamp 6a): el ADMIN dibuja polígonos en el
 * mapa (clic para agregar vértices) y les asigna conductores. Base de la
 * verificación de cobertura al crear pedidos (point-in-zone) y de la preferencia
 * de asignación por zona. Solo ADMIN (el API lo exige); núcleo, sin gating.
 *
 * Vive dentro del shell de Controles (sub-nav de 230px): encabezado propio de
 * 20px, tarjeta de formulario de 400px + mapa a la derecha, banner de modo
 * dibujo con contador de vértices en vivo y zonas existentes atenuadas como
 * contexto.
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

/** Iniciales para el avatarcito navy de los chips de conductor (máx. 2 letras). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const letters = `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  return letters || "?";
}

/** Avatar circular navy de 16px con iniciales blancas. */
function DriverDot({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-navy text-[8px] font-bold text-white"
    >
      {initials(name)}
    </span>
  );
}

/** Etiqueta de sección del formulario (11px, semibold). */
function FormLabel({ htmlFor, children }: { htmlFor?: string; children: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[11px] font-semibold text-text-secondary">
      {children}
    </label>
  );
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
  // Estado solo-UI: desplegable "+ Agregar" de conductores.
  const [pickerOpen, setPickerOpen] = useState(false);

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
    setPickerOpen(false);
    setShowForm(true);
  }
  function openEdit(z: Zone) {
    setEditingId(z.id);
    setForm({ name: z.name, color: z.color, driverIds: z.driverIds });
    setPoints(z.geometry.points);
    setDrawing(false);
    setPickerOpen(false);
    setShowForm(true);
  }
  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setPoints([]);
    setDrawing(false);
    setPickerOpen(false);
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
  const availableDrivers = drivers.filter((d) => !form.driverIds.includes(d.id));

  // Clases del chip de etiqueta que Leaflet pinta sobre cada zona del mapa.
  const contextLabelClass =
    "!rounded-md !border-0 !bg-white/85 !px-2 !py-0.5 !text-[11px] !text-text-secondary !shadow-none";
  const editingLabelClass =
    "!rounded-md !border-0 !bg-navy !px-2 !py-0.5 !text-[11px] !font-semibold !text-white !shadow-none";

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-navy">
            Zonas de entrega
          </h1>
          <p className="mt-0.5 max-w-2xl text-[12.5px] text-text-secondary">
            Dibuja polígonos y asígnales conductores · verifican cobertura y orientan la
            asignación
          </p>
        </div>
        <Button variant="cta" icon={<Plus strokeWidth={2} />} onClick={openCreate}>
          Nueva zona
        </Button>
      </div>

      {error && (
        <Banner kind="error" onDismiss={() => void load()}>
          {error} — toca para reintentar.
        </Banner>
      )}

      {showForm && (
        <div className="grid grid-cols-1 items-stretch gap-3.5 lg:grid-cols-[400px_1fr]">
          {/* Tarjeta de formulario (400px) */}
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
            <div className="text-[13.5px] font-semibold text-navy">
              {editingId ? `Editar zona — ${form.name || "sin nombre"}` : "Nueva zona"}
            </div>

            <div>
              <FormLabel htmlFor="zona-nombre">Nombre</FormLabel>
              <input
                id="zona-nombre"
                className={inputClass}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                maxLength={80}
                placeholder="p. ej. Norte"
              />
            </div>

            <div>
              <FormLabel>Color de la zona</FormLabel>
              <div className="flex gap-[7px]">
                {ZONE_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Color ${c}`}
                    aria-pressed={form.color === c}
                    onClick={() => setForm((f) => ({ ...f, color: c }))}
                    style={{ backgroundColor: c }}
                    className={`h-[26px] w-[26px] rounded-full border-2 transition duration-200 ease-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${
                      form.color === c
                        ? "border-navy shadow-[inset_0_0_0_2px_var(--surface)]"
                        : "border-transparent hover:border-border-strong"
                    }`}
                  />
                ))}
              </div>
            </div>

            <div>
              <FormLabel>Conductores de la zona</FormLabel>
              {drivers.length === 0 ? (
                <p className="text-xs text-text-tertiary">No hay conductores registrados.</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {form.driverIds.map((id) => {
                      const name = driverName.get(id) ?? id;
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 py-[3px] pl-1.5 pr-2 text-[11.5px] font-medium text-navy"
                        >
                          <DriverDot name={name} />
                          {name}
                          <button
                            type="button"
                            aria-label={`Quitar a ${name}`}
                            onClick={() => toggleDriver(id)}
                            className="rounded-full text-text-tertiary transition duration-200 ease-brand hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                          >
                            <X aria-hidden="true" className="h-3 w-3" strokeWidth={2} />
                          </button>
                        </span>
                      );
                    })}
                    <button
                      type="button"
                      aria-expanded={pickerOpen}
                      onClick={() => setPickerOpen((v) => !v)}
                      className="inline-flex items-center gap-1 rounded-full border border-dashed border-border-strong px-2.5 py-[3px] text-[11.5px] text-text-tertiary transition duration-200 ease-brand hover:border-navy hover:text-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                    >
                      <Plus aria-hidden="true" className="h-3 w-3" strokeWidth={2} />
                      Agregar
                    </button>
                  </div>
                  {pickerOpen && (
                    <div className="mt-2 max-h-32 space-y-px overflow-y-auto rounded-md border border-border p-1">
                      {availableDrivers.length === 0 ? (
                        <p className="px-2 py-1 text-xs text-text-tertiary">
                          Todos los conductores ya están asignados.
                        </p>
                      ) : (
                        availableDrivers.map((d) => (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => toggleDriver(d.id)}
                            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-navy transition duration-200 ease-brand hover:bg-niebla focus-visible:outline-2 focus-visible:outline-navy"
                          >
                            <DriverDot name={d.name} />
                            {d.name}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Banner de modo dibujo con contador de vértices en vivo. */}
            {drawing ? (
              <div className="flex items-center gap-2 rounded-md border border-lima bg-lima/25 px-2.5 py-2 text-[11.5px] text-lime-ink">
                <span
                  aria-hidden="true"
                  className="h-[7px] w-[7px] shrink-0 animate-livepulse rounded-full bg-lime-ink"
                />
                <span>
                  <strong className="font-bold">Modo dibujo:</strong> clic en el mapa agrega
                  vértices · {points.length} {points.length === 1 ? "vértice" : "vértices"}
                </span>
                <span className="ml-auto flex shrink-0 gap-2 font-semibold">
                  <button
                    type="button"
                    onClick={() => setPoints((p) => p.slice(0, -1))}
                    disabled={points.length === 0}
                    className="rounded text-lime-ink transition hover:underline disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy"
                  >
                    Deshacer
                  </button>
                  <button
                    type="button"
                    onClick={() => setPoints([])}
                    disabled={points.length === 0}
                    className="rounded text-lime-ink transition hover:underline disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy"
                  >
                    Limpiar
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawing(false)}
                    className="rounded text-lime-ink transition hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy"
                  >
                    Terminar
                  </button>
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-md border border-border bg-niebla px-2.5 py-2 text-[11.5px] text-text-secondary">
                <span
                  aria-hidden="true"
                  className="h-[7px] w-[7px] shrink-0 rounded-full bg-text-tertiary"
                />
                <span>
                  Modo dibujo desactivado · {points.length}{" "}
                  {points.length === 1 ? "vértice" : "vértices"}
                </span>
                <button
                  type="button"
                  onClick={() => setDrawing(true)}
                  className="ml-auto shrink-0 rounded font-semibold text-navy transition hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy"
                >
                  Dibujar
                </button>
              </div>
            )}

            <div className="mt-auto flex gap-2 pt-1">
              <Button variant="cta" className="flex-1" onClick={save} disabled={saving}>
                {saving ? "Guardando…" : editingId ? "Guardar cambios" : "Crear zona"}
              </Button>
              <Button variant="secondary" onClick={closeForm}>
                Cancelar
              </Button>
            </div>
          </div>

          {/* Mapa: polígono en edición + zonas existentes atenuadas como contexto. */}
          <div className="relative min-h-[420px] overflow-hidden rounded-lg border border-border">
            <MapContainer
              center={BOGOTA}
              zoom={11}
              style={{ position: "absolute", inset: 0, zIndex: 0 }}
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <ClickCapture
                active={drawing}
                onAdd={(p) => setPoints((prev) => [...prev, p])}
              />
              {/* Zonas existentes como contexto (60% de opacidad + chip de nombre). */}
              {(zones ?? [])
                .filter((z) => z.id !== editingId)
                .map((z) => (
                  <Polygon
                    key={z.id}
                    positions={z.geometry.points.map((p) => [p.lat, p.lng])}
                    pathOptions={{ color: z.color, weight: 1.5, opacity: 0.6, fillOpacity: 0.15 }}
                  >
                    <Tooltip permanent direction="center" className={contextLabelClass}>
                      {z.name}
                    </Tooltip>
                  </Polygon>
                ))}
              {points.length >= 2 && (
                <Polygon
                  positions={points.map((p) => [p.lat, p.lng])}
                  pathOptions={{ color: form.color, weight: 2.5, fillOpacity: 0.18 }}
                >
                  <Tooltip permanent direction="center" className={editingLabelClass}>
                    {`${form.name || "Nueva zona"} · editando`}
                  </Tooltip>
                </Polygon>
              )}
              {points.map((p, i) => (
                <Marker key={i} position={[p.lat, p.lng]} icon={markerIcon} />
              ))}
            </MapContainer>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface p-4 shadow-soft">
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
            <table className="w-full text-sm text-navy">
              <thead>
                <tr className={theadRowClass}>
                  <th className="py-2 pr-4 font-semibold">Zona</th>
                  <th className="py-2 pr-4 font-semibold">Vértices</th>
                  <th className="py-2 pr-4 font-semibold">Conductores</th>
                  <th className="py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.id} className={tableRowClass}>
                    <td className="py-2.5 pr-4">
                      <span className="inline-flex items-center gap-2 font-semibold">
                        <span
                          aria-hidden="true"
                          style={{ backgroundColor: z.color }}
                          className="h-3 w-3 rounded-full"
                        />
                        {z.name}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-text-secondary">
                      {z.geometry.points.length}
                    </td>
                    <td className="py-2.5 pr-4">
                      {z.driverIds.length === 0 ? (
                        <span className="text-text-tertiary">Sin asignar</span>
                      ) : (
                        <span className="flex flex-wrap gap-1.5">
                          {z.driverIds.map((id) => {
                            const name = driverName.get(id) ?? id;
                            return (
                              <span
                                key={id}
                                className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 py-[3px] pl-1.5 pr-2 text-[11.5px] font-medium text-navy"
                              >
                                <DriverDot name={name} />
                                {name}
                              </span>
                            );
                          })}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="secondary" onClick={() => openEdit(z)}>
                          Editar
                        </Button>
                        <button
                          onClick={() => void remove(z)}
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
