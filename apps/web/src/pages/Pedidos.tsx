import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ORDER_STATUSES } from "@moveos/shared";
import { api } from "../api";
import { useRealtimeReload } from "../realtime";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  Loading,
  PageHeader,
  StatusBadge,
  inputClass,
  tableRowClass,
  theadRowClass,
} from "../components/ui";

interface Order {
  id: string;
  trackingNumber: string | null;
  customerName: string;
  customerPhone: string;
  addressRaw: string;
  status: string;
  weightKg: number;
  geocodeSource: string | null;
  client: { id: string; name: string } | null;
  service: { id: string; name: string; identifier: string } | null;
  customFields: Record<string, string> | null;
  createdAt: string;
}

interface CustomPropDef {
  id: string;
  name: string;
  visibleToDriver: boolean;
  visibleToRecipient: boolean;
}

interface ClientOption {
  id: string;
  name: string;
}

interface ServiceOption {
  id: string;
  name: string;
  identifier: string;
}

interface OrderEvent {
  id: string;
  type: string;
  details: string | null;
  createdAt: string;
}

const EVENT_LABELS: Record<string, string> = {
  CREATED: "Pedido creado",
  GEOCODED: "Dirección geocodificada",
  OUT_OF_ZONE: "Fuera de cobertura",
  ASSIGNED: "Asignado a ruta",
  LOADED: "Cargado en el vehículo",
  DISPATCHED: "Despachado",
  IN_TRANSIT: "En camino",
  ARRIVED: "Conductor en el punto",
  DELIVERED: "Entregado",
  FAILED: "Entrega fallida",
  NOTIFIED: "Negocio notificado",
};

interface SavedView {
  id: string;
  name: string;
  filters: Record<string, string>;
}

const STATUS_ES: Record<string, string> = {
  PENDING: "Pendiente",
  GEOCODED: "Geocodificado",
  ASSIGNED: "Asignado",
  DISPATCHED: "Despachado",
  IN_TRANSIT: "En camino",
  ARRIVED: "En sitio",
  DELIVERED: "Entregado",
  FAILED: "Fallido",
  REJECTED: "Rechazado",
  CANCELLED: "Cancelado",
};

/** Plantilla CSV — incluye una columna por cada campo personalizado del tenant. */
function buildCsvTemplate(props: CustomPropDef[]): string {
  const extra = props.map((p) => p.name);
  const header = ["customerName", "customerPhone", "addressRaw", "addressNotes", "weightKg", ...extra];
  const blanks = extra.map(() => "");
  const rows = [
    ["Laura Martínez", "+573101000001", '"Cra 13 # 54-20, Chapinero"', "Portón verde", "2", ...blanks],
    ["Pedro Sánchez", "+573101000002", '"Cl 72 # 10-34"', "", "1.2", ...blanks],
  ];
  return [header, ...rows].map((r) => r.join(",")).join("\n") + "\n";
}

/** Parser CSV mínimo con soporte de comillas (suficiente para la plantilla). */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const parseLine = (line: string): string[] => {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === "," && !inQuotes) {
        cells.push(current.trim());
        current = "";
      } else current += ch;
    }
    cells.push(current.trim());
    return cells;
  };
  const headers = parseLine(lines[0]!);
  return lines.slice(1).map((line) => {
    const cells = parseLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

/** Paginación por ventana: traemos de a PAGE_SIZE y crecemos con "Ver más",
 *  hasta MAX_WINDOW, para no descargar toda la tabla de pedidos de un golpe. */
const PAGE_SIZE = 50;
const MAX_WINDOW = 500;

export default function Pedidos() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Detalle por fila del último import CSV (filas que el servidor rechazó).
  const [importFailures, setImportFailures] = useState<
    { row: number; error: string }[]
  >([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  // Ref para que el callback de tiempo real lea siempre el tamaño actual de la
  // ventana (sin re-suscribir el SSE en cada "Ver más").
  const visibleCountRef = useRef(PAGE_SIZE);
  visibleCountRef.current = visibleCount;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, OrderEvent[]>>({});
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  // Campos personalizados del tenant (Tier 2 §9): se rellenan en el alta manual
  // y se mapean por nombre de columna en el import CSV.
  const [customProps, setCustomProps] = useState<CustomPropDef[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  // Filtros (cliente sobre la ventana cargada) + vistas guardadas.
  const [fStatus, setFStatus] = useState("");
  const [fClientId, setFClientId] = useState("");
  const [fServiceId, setFServiceId] = useState("");
  const [fQ, setFQ] = useState("");
  const [views, setViews] = useState<SavedView[]>([]);

  const shown = useMemo(() => {
    const q = fQ.trim().toLowerCase();
    return orders.filter(
      (o) =>
        (!fStatus || o.status === fStatus) &&
        (!fClientId || o.client?.id === fClientId) &&
        (!fServiceId ||
          (fServiceId === "__none__"
            ? !o.service
            : o.service?.id === fServiceId)) &&
        (!q ||
          (o.trackingNumber ?? "").toLowerCase().includes(q) ||
          o.customerName.toLowerCase().includes(q) ||
          o.addressRaw.toLowerCase().includes(q)),
    );
  }, [orders, fStatus, fClientId, fServiceId, fQ]);

  const activeFilters = Boolean(fStatus || fClientId || fServiceId || fQ.trim());

  function clearFilters() {
    setFStatus("");
    setFClientId("");
    setFServiceId("");
    setFQ("");
  }

  async function loadViews() {
    setViews(await api<SavedView[]>("GET", "/saved-views?page=pedidos"));
  }
  function applyView(v: SavedView) {
    setFStatus(v.filters.status ?? "");
    setFClientId(v.filters.clientId ?? "");
    setFServiceId(v.filters.serviceId ?? "");
    setFQ(v.filters.q ?? "");
  }
  async function saveCurrentView() {
    const name = window.prompt("Nombre de la vista (p. ej. 'Pendientes hoy')")?.trim();
    if (!name) return;
    const filters: Record<string, string> = {};
    if (fStatus) filters.status = fStatus;
    if (fClientId) filters.clientId = fClientId;
    if (fServiceId) filters.serviceId = fServiceId;
    if (fQ.trim()) filters.q = fQ.trim();
    try {
      await api("POST", "/saved-views", { page: "pedidos", name, filters });
      await loadViews();
      setNotice(`Vista "${name}" guardada`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la vista");
    }
  }
  async function deleteView(id: string) {
    try {
      await api("DELETE", `/saved-views/${id}`);
      await loadViews();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar la vista");
    }
  }

  async function load(count: number) {
    try {
      const rows = await api<Order[]>("GET", `/orders?take=${count}`);
      setOrders(rows);
      // Si la página vino llena (y no tocamos el tope), probablemente hay más.
      setHasMore(rows.length === count && count < MAX_WINDOW);
    } finally {
      setLoading(false);
    }
  }
  function loadMore() {
    const next = Math.min(visibleCount + PAGE_SIZE, MAX_WINDOW);
    setVisibleCount(next);
    void load(next);
  }
  // Tiempo real: recarga la ventana actual en sitio (el ref evita un cierre
  // obsoleto del tamaño de ventana).
  useRealtimeReload(["order"], () => void load(visibleCountRef.current), {
    throttleMs: 2000,
  });
  useEffect(() => {
    void api<ClientOption[]>("GET", "/clients").then(setClients);
    void api<ServiceOption[]>("GET", "/services").then(setServices).catch(() => {});
    void api<{ items: CustomPropDef[] }>("GET", "/custom-properties")
      .then((r) => setCustomProps(r.items))
      .catch(() => {});
    void loadViews();
  }, []);

  async function toggleBitacora(orderId: string) {
    if (expanded === orderId) {
      setExpanded(null);
      return;
    }
    const detail = await api<{ events: OrderEvent[] }>("GET", `/orders/${orderId}`);
    setEvents((e) => ({ ...e, [orderId]: detail.events }));
    setExpanded(orderId);
  }

  function downloadTemplate() {
    const blob = new Blob([buildCsvTemplate(customProps)], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "plantilla_pedidos_move.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importCsv(file: File) {
    setError(null);
    setNotice(null);
    setImportFailures([]);
    try {
      const rows = parseCsv(await file.text());
      if (rows.length === 0) throw new Error("El archivo no tiene filas de datos");
      const payload = rows.map((r) => {
        // Campos personalizados (Tier 2 §9): cada columna del CSV cuyo encabezado
        // coincide (sin distinguir mayúsculas) con un campo del tenant se mapea a
        // su id; el API ignora las claves desconocidas.
        const customFields: Record<string, string> = {};
        for (const p of customProps) {
          const col = Object.keys(r).find(
            (h) => h.trim().toLowerCase() === p.name.trim().toLowerCase(),
          );
          const val = col ? r[col] : undefined;
          if (val && val.trim() !== "") customFields[p.id] = val.trim();
        }
        return {
          customerName: r.customerName,
          customerPhone: r.customerPhone,
          addressRaw: r.addressRaw,
          addressNotes: r.addressNotes || undefined,
          weightKg: r.weightKg ? Number(r.weightKg) : undefined,
          ...(Object.keys(customFields).length > 0 ? { customFields } : {}),
        };
      });
      const res = await api<{
        created: number;
        failed: number;
        results: { row: number; ok: boolean; error?: string }[];
      }>("POST", "/orders/bulk", payload);
      // Las filas buenas entran aunque otras fallen: mostramos ambas caras.
      setImportFailures(
        res.results
          .filter((r) => !r.ok)
          .map((r) => ({ row: r.row, error: r.error ?? "Error" })),
      );
      if (res.created > 0) {
        setNotice(
          res.failed > 0
            ? `${res.created} pedidos importados · ${res.failed} con error (revisa el detalle abajo)`
            : `${res.created} pedidos importados correctamente`,
        );
      } else {
        setError(
          `Ninguna fila se importó: ${res.failed} con error. Revisa el detalle abajo.`,
        );
      }
      await load(visibleCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error importando CSV");
    }
  }

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const data = new FormData(e.currentTarget);
    // Campos personalizados (Tier 2 §9): inputs nombrados cf:<id>.
    const customFields: Record<string, string> = {};
    for (const p of customProps) {
      const v = data.get(`cf:${p.id}`);
      if (typeof v === "string" && v.trim() !== "") customFields[p.id] = v.trim();
    }
    try {
      await api("POST", "/orders", {
        clientId: data.get("clientId") || undefined,
        serviceId: data.get("serviceId") || undefined,
        customerName: data.get("customerName"),
        customerPhone: data.get("customerPhone"),
        addressRaw: data.get("addressRaw"),
        addressNotes: data.get("addressNotes") || undefined,
        weightKg: Number(data.get("weightKg") || 1),
        pickupAddressRaw: data.get("pickupAddressRaw") || undefined,
        pickupNotes: data.get("pickupNotes") || undefined,
        ...(Object.keys(customFields).length > 0 ? { customFields } : {}),
      });
      setShowForm(false);
      await load(visibleCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pedidos"
        actions={
          <>
            <Button variant="secondary" onClick={downloadTemplate}>
              Plantilla CSV
            </Button>
            <Button variant="secondary" onClick={() => fileRef.current?.click()}>
              Importar CSV
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importCsv(file);
                e.target.value = "";
              }}
            />
            <Button onClick={() => setShowForm((v) => !v)}>
              {showForm ? "Cancelar" : "Nuevo pedido"}
            </Button>
          </>
        }
      />
      {notice && (
        <Banner kind="success" onDismiss={() => setNotice(null)}>
          {notice}
        </Banner>
      )}
      {error && (
        <Banner kind="error" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      {importFailures.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning-bg p-3 text-sm text-warning">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-semibold">
              Filas con error en el import ({importFailures.length})
            </span>
            <button
              onClick={() => setImportFailures([])}
              className="text-xs font-bold opacity-60"
              aria-label="Cerrar detalle de errores del import"
            >
              ✕
            </button>
          </div>
          <ul className="max-h-40 list-disc space-y-0.5 overflow-auto pl-5">
            {importFailures.map((f) => (
              <li key={f.row}>
                Fila {f.row}: {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {showForm && (
        <Card title="Nuevo pedido">
          <form onSubmit={onCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Negocio cliente (quién envía)">
                <select name="clientId" className={inputClass}>
                  <option value="">— Sin negocio asignado —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Destinatario (quién recibe)">
              <input name="customerName" className={inputClass} required />
            </Field>
            <Field label="Teléfono del destinatario">
              <input name="customerPhone" className={inputClass} required placeholder="+57..." />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Dirección (formal o informal)">
                <input
                  name="addressRaw"
                  className={inputClass}
                  required
                  placeholder='Ej: "Cra 13 # 54-20" o "frente al colegio San José"'
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Referencias de entrega">
                <input name="addressNotes" className={inputClass} placeholder="Casa de portón verde…" />
              </Field>
            </div>
            <Field label="Peso (kg)">
              <input name="weightKg" type="number" step="0.1" defaultValue="1" className={inputClass} />
            </Field>
            <Field label="Servicio (promesa de entrega · SLA)">
              <select name="serviceId" className={inputClass} defaultValue="">
                <option value="">— Sin servicio —</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.identifier})
                  </option>
                ))}
              </select>
            </Field>
            {customProps.length > 0 && (
              <div className="sm:col-span-2 grid grid-cols-1 gap-4 rounded-lg border border-niebla p-3 sm:grid-cols-2">
                <div className="sm:col-span-2 text-xs font-semibold uppercase text-navy/50">
                  Datos personalizados
                </div>
                {customProps.map((p) => (
                  <Field
                    key={p.id}
                    label={`${p.name}${
                      p.visibleToRecipient
                        ? " (visible al destinatario)"
                        : p.visibleToDriver
                          ? " (visible al conductor)"
                          : ""
                    }`}
                  >
                    <input name={`cf:${p.id}`} className={inputClass} />
                  </Field>
                ))}
              </div>
            )}
            <div className="sm:col-span-2">
              <Field label="Recogida en origen (opcional — para flujo pickup→entrega)">
                <input
                  name="pickupAddressRaw"
                  className={inputClass}
                  placeholder="Bodega/tienda del cliente donde se recoge el paquete"
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Referencias de recogida">
                <input name="pickupNotes" className={inputClass} placeholder="Muelle 3, preguntar por despacho…" />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit">Crear pedido</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-navy/70">Estado</span>
            <select className={inputClass} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              <option value="">Todos</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_ES[s] ?? s}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-navy/70">Negocio</span>
            <select className={inputClass} value={fClientId} onChange={(e) => setFClientId(e.target.value)}>
              <option value="">Todos</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-navy/70">Servicio</span>
            <select className={inputClass} value={fServiceId} onChange={(e) => setFServiceId(e.target.value)}>
              <option value="">Todos</option>
              <option value="__none__">Sin servicio</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[12rem] flex-1 text-sm">
            <span className="mb-1 block font-medium text-navy/70">Buscar</span>
            <input
              type="search"
              className={inputClass}
              placeholder="Guía, destinatario o dirección…"
              value={fQ}
              onChange={(e) => setFQ(e.target.value)}
            />
          </label>
          {activeFilters && (
            <Button variant="secondary" onClick={clearFilters}>
              Limpiar
            </Button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-niebla pt-3">
          <span className="text-xs font-semibold uppercase text-navy/50">Vistas guardadas</span>
          {views.length === 0 && <span className="text-xs text-navy/40">ninguna aún</span>}
          {views.map((v) => (
            <span
              key={v.id}
              className="inline-flex items-center gap-1 rounded-full border border-cielo bg-white px-2 py-0.5 text-xs"
            >
              <button onClick={() => applyView(v)} className="font-medium text-navy hover:underline">
                {v.name}
              </button>
              <button
                onClick={() => void deleteView(v.id)}
                aria-label={`Borrar vista ${v.name}`}
                className="text-navy/40 hover:text-danger"
              >
                ×
              </button>
            </span>
          ))}
          <Button variant="secondary" onClick={() => void saveCurrentView()} disabled={!activeFilters}>
            Guardar vista actual
          </Button>
        </div>
      </Card>

      <Card>
        {loading ? (
          <Loading label="Cargando pedidos…" />
        ) : (
        <>
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className={theadRowClass}>
              <th className="py-2">Guía</th>
              <th>Negocio cliente</th>
              <th>Servicio</th>
              <th>Destinatario</th>
              <th>Dirección</th>
              <th>Peso</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((o) => (
              <Fragment key={o.id}>
                <tr
                  /* Virtualización ligera: el navegador omite el render de las
                     filas fuera de pantalla (sin dependencias ni refactor de la
                     tabla); no-op donde no haya soporte. */
                  className={`cursor-pointer hover:bg-niebla/60 [content-visibility:auto] [contain-intrinsic-size:auto_44px] ${tableRowClass}`}
                  role="button"
                  tabIndex={0}
                  aria-expanded={expanded === o.id}
                  title="Ver bitácora del pedido"
                  onClick={() => void toggleBitacora(o.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      void toggleBitacora(o.id);
                    }
                  }}
                >
                  <td className="py-2 font-mono text-xs font-semibold">
                    <span
                      aria-hidden="true"
                      className={`mr-1.5 inline-block text-navy/40 transition-transform ${
                        expanded === o.id ? "rotate-90" : ""
                      }`}
                    >
                      ▸
                    </span>
                    {o.trackingNumber ?? "—"}
                  </td>
                  <td className="text-sm">{o.client?.name ?? "—"}</td>
                  <td className="text-sm">
                    {o.service ? (
                      <span title={o.service.name}>{o.service.identifier}</span>
                    ) : (
                      <span className="text-navy/40">—</span>
                    )}
                  </td>
                  <td>
                    <div className="font-medium">{o.customerName}</div>
                    <div className="text-xs text-navy/50">{o.customerPhone}</div>
                  </td>
                  <td className="max-w-xs truncate">{o.addressRaw}</td>
                  <td>{o.weightKg} kg</td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                </tr>
                {expanded === o.id && (
                  <tr className={`bg-niebla/40 ${tableRowClass}`}>
                    <td colSpan={7} className="px-4 py-3">
                      {customProps.length > 0 &&
                        o.customFields &&
                        customProps.some((p) => o.customFields?.[p.id]) && (
                          <div className="mb-3">
                            <div className="text-xs font-semibold uppercase text-navy/50">
                              Datos personalizados
                            </div>
                            <dl className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                              {customProps
                                .filter((p) => o.customFields?.[p.id])
                                .map((p) => (
                                  <div key={p.id} className="flex gap-1">
                                    <dt className="text-navy/50">{p.name}:</dt>
                                    <dd className="font-medium">
                                      {o.customFields?.[p.id]}
                                    </dd>
                                  </div>
                                ))}
                            </dl>
                          </div>
                        )}
                      <div className="text-xs font-semibold uppercase text-navy/50">
                        Bitácora del pedido
                      </div>
                      <ol className="mt-2 space-y-1">
                        {(events[o.id] ?? []).map((ev) => (
                          <li key={ev.id} className="flex items-baseline gap-3 text-sm">
                            <span className="font-mono text-xs text-navy/50">
                              {new Date(ev.createdAt).toLocaleString("es-CO", {
                                timeZone: "America/Bogota",
                                day: "2-digit",
                                month: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                            <span className="h-2 w-2 shrink-0 rounded-full bg-lima" />
                            <span className="font-medium">
                              {EVENT_LABELS[ev.type] ?? ev.type}
                            </span>
                            {ev.details && (
                              <span className="text-navy/60">{ev.details}</span>
                            )}
                          </li>
                        ))}
                      </ol>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState
                    phrase="Entregas rápidas, operaciones inteligentes."
                    action={
                      <Button onClick={() => setShowForm(true)}>Nuevo pedido</Button>
                    }
                  >
                    Sin pedidos aún. Cree el primero o importe un CSV.
                  </EmptyState>
                </td>
              </tr>
            )}
            {orders.length > 0 && shown.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-navy/40">
                  Ningún pedido coincide con los filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        {(hasMore || orders.length > PAGE_SIZE) && (
          <div className="mt-3 flex items-center justify-between gap-3 text-sm text-navy/60">
            <span>
              Mostrando {shown.length}
              {activeFilters ? ` de ${orders.length}` : ""} pedidos
            </span>
            {hasMore && (
              <Button variant="secondary" onClick={loadMore}>
                Ver más
              </Button>
            )}
          </div>
        )}
        </>
        )}
      </Card>
    </div>
  );
}
