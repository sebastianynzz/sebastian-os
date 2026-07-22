import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  MapPin,
  Phone,
  Plus,
  Search,
  Upload,
  X,
} from "lucide-react";
import { ORDER_STATUSES } from "@moveos/shared";
import { api } from "../api";
import { useRealtimeReload } from "../realtime";
import {
  Banner,
  Button,
  Card,
  Drawer,
  EmptyState,
  Field,
  KpiCard,
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
  // Inteligencia de direcciones (el payload de /orders ya trae la fila
  // completa): confianza 0–1 del geocodificado y confirmación humana del pin.
  geoConfidence: number | null;
  addressVerifiedAt: string | null;
  deliveredAt: string | null;
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

interface AddressCheck {
  confidence: number;
  ambiguous: boolean;
  knownAddress: boolean;
  source: string;
  hasZones: boolean;
  serviceable: boolean;
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

/**
 * Confianza de geocodificación por pedido (el moat, visible en la tabla).
 * Refleja el umbral del API (LOW_CONFIDENCE_THRESHOLD = 0.7): confirmada por
 * un humano o con confianza alta → limón; fallida → errada por corregir;
 * el resto (informal / sin confirmar) → confianza media.
 */
type GeoLevel = "confirmada" | "media" | "errada";

function geoLevel(o: Order): GeoLevel {
  if (o.status === "FAILED") return "errada";
  if (o.addressVerifiedAt || (o.geoConfidence ?? 0) >= 0.7) return "confirmada";
  return "media";
}

const GEO_DOT: Record<GeoLevel, { dot: string; title: string }> = {
  confirmada: { dot: "bg-lima", title: "Dirección confirmada" },
  media: { dot: "bg-warning", title: "Dirección informal — confianza media" },
  errada: { dot: "bg-danger", title: "Dirección errada reportada" },
};

/** Tarjetas KPI de estado (fila clicable que filtra la tabla). */
const STATUS_CARDS: {
  status: string;
  label: string;
  top: string;
  valueClass?: string;
}[] = [
  { status: "PENDING", label: "Pendientes", top: "border-t-cielo" },
  { status: "ASSIGNED", label: "Asignados", top: "border-t-info" },
  { status: "IN_TRANSIT", label: "En camino", top: "border-t-navy" },
  { status: "DELIVERED", label: "Entregados hoy", top: "border-t-lima", valueClass: "text-lime-ink" },
  { status: "FAILED", label: "Fallidos", top: "border-t-danger", valueClass: "text-danger" },
];

/** Día calendario en Bogotá (frontera de día del producto). */
function bogotaDay(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

function fmtTs(iso: string): string {
  return new Date(iso).toLocaleString("es-CO", {
    timeZone: "America/Bogota",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Botón fantasma compacto para enlaces (Ver en mapa / Llamar / Corregir). */
const ghostLinkClass =
  "inline-flex items-center gap-1.5 rounded-md border border-navy/25 bg-surface px-2.5 py-1 text-xs font-medium text-navy transition duration-200 ease-brand hover:bg-lima/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy";

/** Select compacto de la toolbar unificada. */
const toolbarSelectClass =
  "rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-[13px] text-navy focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/25";

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
  // Estado del último import (banner limón con conteo + "Ver detalle").
  const [importResult, setImportResult] = useState<{
    created: number;
    failed: number;
    fileName: string;
  } | null>(null);
  const [showImportDetail, setShowImportDetail] = useState(false);
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
  // Vista previa de geocodificación en el alta manual (el moat como feature del
  // despachador): avisa "dirección ambigua / fuera de zona" ANTES de crear.
  const [addressCheck, setAddressCheck] = useState<AddressCheck | null>(null);
  const [checkingAddress, setCheckingAddress] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Filtros (cliente sobre la ventana cargada) + vistas guardadas.
  const [fStatus, setFStatus] = useState("");
  const [fClientId, setFClientId] = useState("");
  const [fServiceId, setFServiceId] = useState("");
  const [fQ, setFQ] = useState("");
  // Filtro UI-only de la tarjeta "Dirección dudosa" (confianza media).
  const [fDudosa, setFDudosa] = useState(false);
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
        (!fDudosa || geoLevel(o) === "media") &&
        (!q ||
          (o.trackingNumber ?? "").toLowerCase().includes(q) ||
          o.customerName.toLowerCase().includes(q) ||
          o.addressRaw.toLowerCase().includes(q)),
    );
  }, [orders, fStatus, fClientId, fServiceId, fQ, fDudosa]);

  // Conteos de la fila de KPIs (sobre la ventana cargada).
  const counts = useMemo(() => {
    const byStatus: Record<string, number> = {};
    let dudosas = 0;
    let deliveredToday = 0;
    const today = bogotaDay(new Date());
    for (const o of orders) {
      byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
      if (geoLevel(o) === "media") dudosas++;
      if (
        o.status === "DELIVERED" &&
        o.deliveredAt &&
        bogotaDay(new Date(o.deliveredAt)) === today
      )
        deliveredToday++;
    }
    return { byStatus, dudosas, deliveredToday };
  }, [orders]);

  const activeFilters = Boolean(
    fStatus || fClientId || fServiceId || fQ.trim() || fDudosa,
  );

  function clearFilters() {
    setFStatus("");
    setFClientId("");
    setFServiceId("");
    setFQ("");
    setFDudosa(false);
  }

  async function loadViews() {
    setViews(await api<SavedView[]>("GET", "/saved-views?page=pedidos"));
  }
  function applyView(v: SavedView) {
    setFStatus(v.filters.status ?? "");
    setFClientId(v.filters.clientId ?? "");
    setFServiceId(v.filters.serviceId ?? "");
    setFQ(v.filters.q ?? "");
    setFDudosa(false);
  }
  /** Una vista está "activa" si sus filtros coinciden con los actuales. */
  function viewIsActive(v: SavedView): boolean {
    return (
      (v.filters.status ?? "") === fStatus &&
      (v.filters.clientId ?? "") === fClientId &&
      (v.filters.serviceId ?? "") === fServiceId &&
      (v.filters.q ?? "") === fQ.trim() &&
      !fDudosa
    );
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
    setImportResult(null);
    setShowImportDetail(false);
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
        setImportResult({
          created: res.created,
          failed: res.failed,
          fileName: file.name,
        });
      } else {
        setError(
          `Ninguna fila se importó: ${res.failed} con error. Revisa el detalle abajo.`,
        );
        setShowImportDetail(res.failed > 0);
      }
      await load(visibleCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error importando CSV");
    }
  }

  function dismissImport() {
    setImportResult(null);
    setImportFailures([]);
    setShowImportDetail(false);
  }

  async function validateAddress(addressRaw: string) {
    if (addressRaw.trim().length < 5) {
      setAddressCheck(null);
      return;
    }
    setCheckingAddress(true);
    try {
      setAddressCheck(
        await api<AddressCheck>("POST", "/addresses/validate", { addressRaw }),
      );
    } catch {
      setAddressCheck(null);
    } finally {
      setCheckingAddress(false);
    }
  }

  function closeForm() {
    setShowForm(false);
    setAddressCheck(null);
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
      setAddressCheck(null);
      await load(visibleCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    }
  }

  const filterNote = fStatus
    ? ` · filtro "${STATUS_ES[fStatus] ?? fStatus}"`
    : fDudosa
      ? ' · filtro "Dirección dudosa"'
      : "";

  return (
    <div className="space-y-3.5">
      <PageHeader
        title="Pedidos"
        actions={
          <>
            <Button
              variant="secondary"
              icon={<Download strokeWidth={2} />}
              onClick={downloadTemplate}
            >
              Plantilla CSV
            </Button>
            <Button
              variant="secondary"
              icon={<Upload strokeWidth={2} />}
              onClick={() => fileRef.current?.click()}
            >
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
            <Button variant="primary" icon={<Plus strokeWidth={2} />} onClick={() => setShowForm(true)}>
              Nuevo pedido
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

      {/* Estado del último import CSV: banner limón con conteo + detalle. */}
      {importResult && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-lima bg-lima/30 px-3 py-1.5 text-[13px] text-lime-ink"
        >
          <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <span>
            <strong className="font-semibold">
              {importResult.created} pedidos importados
            </strong>{" "}
            del archivo {importResult.fileName}
            {importResult.failed > 0 && <> · {importResult.failed} filas con error</>}
          </span>
          {importResult.failed > 0 && importFailures.length > 0 && (
            <button
              onClick={() => setShowImportDetail((v) => !v)}
              className="text-xs font-semibold text-lime-ink underline-offset-2 hover:underline"
            >
              {showImportDetail ? "Ocultar detalle" : "Ver detalle"}
            </button>
          )}
          <button
            onClick={dismissImport}
            aria-label="Cerrar aviso del import"
            className="ml-auto shrink-0 font-bold opacity-50 hover:opacity-100"
          >
            ×
          </button>
        </div>
      )}

      {showImportDetail && importFailures.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning-bg p-3 text-sm text-warning">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-semibold">
              Filas con error en el import ({importFailures.length})
            </span>
            <button
              onClick={() => setShowImportDetail(false)}
              className="text-xs font-bold opacity-60 hover:opacity-100"
              aria-label="Cerrar detalle de errores del import"
            >
              ×
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

      {/* Resumen por estado: cada tarjeta es un filtro de un clic. */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        {STATUS_CARDS.map((c) => {
          const active = fStatus === c.status;
          const n = counts.byStatus[c.status] ?? 0;
          const value =
            c.status === "DELIVERED" ? counts.deliveredToday : n;
          return (
            <KpiCard
              key={c.status}
              label={c.label}
              value={
                !active && c.valueClass ? (
                  <span className={c.valueClass}>{value}</span>
                ) : (
                  value
                )
              }
              active={active}
              onClick={() => {
                setFStatus(active ? "" : c.status);
              }}
              className={active ? "" : `border-t-[3px] ${c.top}`}
            />
          );
        })}
        <KpiCard
          label="Dirección dudosa"
          value={
            fDudosa ? counts.dudosas : (
              <span className="text-warning">{counts.dudosas}</span>
            )
          }
          active={fDudosa}
          onClick={() => setFDudosa((v) => !v)}
          className={fDudosa ? "border-dashed" : "border-dashed border-border-strong"}
        />
      </div>

      {/* Toolbar unificada: búsqueda + filtros + vistas guardadas. */}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[220px] flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary"
              strokeWidth={2}
            />
            <span className="sr-only">Buscar pedidos</span>
            <input
              type="search"
              className={`${inputClass} pl-8`}
              placeholder="Guía, destinatario o dirección…"
              value={fQ}
              onChange={(e) => setFQ(e.target.value)}
            />
          </label>
          <select
            aria-label="Filtrar por estado"
            className={toolbarSelectClass}
            value={fStatus}
            onChange={(e) => setFStatus(e.target.value)}
          >
            <option value="">Estado: todos</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_ES[s] ?? s}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrar por negocio"
            className={toolbarSelectClass}
            value={fClientId}
            onChange={(e) => setFClientId(e.target.value)}
          >
            <option value="">Negocio: todos</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrar por servicio"
            className={toolbarSelectClass}
            value={fServiceId}
            onChange={(e) => setFServiceId(e.target.value)}
          >
            <option value="">Servicio: todos</option>
            <option value="__none__">Sin servicio</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {activeFilters && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1 text-xs font-medium text-text-tertiary transition hover:text-navy"
            >
              <X aria-hidden="true" className="h-3 w-3" strokeWidth={2} />
              Limpiar
            </button>
          )}
          <span aria-hidden="true" className="h-[22px] w-px bg-border" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-text-tertiary">
            Vistas
          </span>
          {views.map((v) => {
            const active = viewIsActive(v);
            return (
              <span
                key={v.id}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition duration-200 ease-brand ${
                  active
                    ? "bg-navy text-white"
                    : "border border-border bg-surface text-text-secondary hover:border-border-strong hover:text-navy"
                }`}
              >
                <button
                  onClick={() => applyView(v)}
                  aria-pressed={active}
                  className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                >
                  {v.name}
                </button>
                <button
                  onClick={() => void deleteView(v.id)}
                  aria-label={`Borrar vista ${v.name}`}
                  className={`font-bold ${
                    active ? "text-white/50 hover:text-white" : "text-text-tertiary hover:text-danger"
                  }`}
                >
                  ×
                </button>
              </span>
            );
          })}
          <button
            onClick={() => void saveCurrentView()}
            disabled={!activeFilters}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border-strong px-3 py-1 text-xs font-medium text-text-tertiary transition duration-200 ease-brand hover:border-navy/40 hover:text-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus aria-hidden="true" className="h-[11px] w-[11px]" strokeWidth={2} />
            Guardar vista
          </button>
        </div>
      </Card>

      <Card>
        {loading ? (
          <Loading label="Cargando pedidos…" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-navy">
                <thead>
                  <tr className={theadRowClass}>
                    <th className="w-36 py-2 font-semibold">Guía</th>
                    <th className="font-semibold">Negocio</th>
                    <th className="w-20 font-semibold">Servicio</th>
                    <th className="font-semibold">Destinatario</th>
                    <th className="font-semibold">Dirección</th>
                    <th className="w-16 font-semibold">Peso</th>
                    <th className="w-28 font-semibold">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((o) => {
                    const geo = GEO_DOT[geoLevel(o)];
                    const isOpen = expanded === o.id;
                    return (
                      <Fragment key={o.id}>
                        <tr
                          /* Virtualización ligera: el navegador omite el render de las
                             filas fuera de pantalla (sin dependencias ni refactor de la
                             tabla); no-op donde no haya soporte. */
                          className={`cursor-pointer hover:bg-niebla/60 [content-visibility:auto] [contain-intrinsic-size:auto_44px] ${tableRowClass}`}
                          role="button"
                          tabIndex={0}
                          aria-expanded={isOpen}
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
                            <span className="inline-flex items-center gap-1.5">
                              <ChevronRight
                                aria-hidden="true"
                                strokeWidth={2.5}
                                className={`h-3 w-3 shrink-0 text-text-tertiary transition-transform duration-200 ease-brand ${
                                  isOpen ? "rotate-90" : ""
                                }`}
                              />
                              {o.trackingNumber ?? "—"}
                            </span>
                          </td>
                          <td>{o.client?.name ?? "—"}</td>
                          <td>
                            {o.service ? (
                              <span
                                title={o.service.name}
                                className="rounded bg-sky-50 px-1.5 py-px text-[11px] font-semibold text-info"
                              >
                                {o.service.identifier}
                              </span>
                            ) : (
                              <span className="text-text-tertiary">—</span>
                            )}
                          </td>
                          <td>
                            <div className="font-medium">{o.customerName}</div>
                            <div className="text-[11px] text-text-tertiary">
                              {o.customerPhone}
                            </div>
                          </td>
                          <td className="max-w-xs">
                            <span className="flex max-w-full items-center gap-1.5">
                              <span
                                aria-hidden="true"
                                title={geo.title}
                                className={`h-2 w-2 shrink-0 rounded-full ${geo.dot}`}
                              />
                              <span className="sr-only">{geo.title}.</span>
                              <span className="truncate text-text-secondary">
                                {o.addressRaw}
                              </span>
                            </span>
                          </td>
                          <td className="whitespace-nowrap">{o.weightKg} kg</td>
                          <td>
                            <span className="flex items-center gap-2">
                              <StatusBadge status={o.status} />
                              {o.status === "FAILED" && (
                                <Link
                                  to="/direcciones"
                                  onClick={(e) => e.stopPropagation()}
                                  className="whitespace-nowrap text-[11px] font-semibold text-danger underline-offset-2 hover:underline"
                                >
                                  Corregir →
                                </Link>
                              )}
                            </span>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-border/60 bg-sky-50/50">
                            <td colSpan={7} className="px-4 pb-4 pt-3">
                              <div className="flex flex-col gap-5 md:flex-row md:gap-6">
                                {/* Bitácora: línea de tiempo limón del OrderEvent. */}
                                <div className="min-w-0 flex-1">
                                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-text-tertiary">
                                    Bitácora del pedido
                                  </div>
                                  <ol className="flex flex-col">
                                    {(events[o.id] ?? []).map((ev, i, arr) => {
                                      const isLast = i === arr.length - 1;
                                      return (
                                        <li key={ev.id} className="flex gap-2.5">
                                          <div
                                            aria-hidden="true"
                                            className="flex flex-col items-center"
                                          >
                                            <span
                                              className={`mt-[3px] h-2.5 w-2.5 shrink-0 rounded-full ${
                                                isLast
                                                  ? "bg-navy ring-[3px] ring-lima/50"
                                                  : "bg-lima"
                                              }`}
                                            />
                                            {!isLast && (
                                              <span className="w-[2px] flex-1 bg-lima/40" />
                                            )}
                                          </div>
                                          <div
                                            className={`flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 ${
                                              isLast ? "" : "pb-2.5"
                                            }`}
                                          >
                                            <span className="font-mono text-[11px] text-text-tertiary">
                                              {fmtTs(ev.createdAt)}
                                            </span>
                                            <span className="text-[12.5px] font-semibold text-navy">
                                              {EVENT_LABELS[ev.type] ?? ev.type}
                                            </span>
                                            {ev.details && (
                                              <span className="text-xs text-text-tertiary">
                                                {ev.details}
                                              </span>
                                            )}
                                          </div>
                                        </li>
                                      );
                                    })}
                                    {(events[o.id] ?? []).length === 0 && (
                                      <li className="text-xs text-text-tertiary">
                                        Sin eventos registrados.
                                      </li>
                                    )}
                                  </ol>
                                </div>
                                {/* Datos personalizados + acciones fantasma. */}
                                <div className="w-full md:w-[280px] md:flex-none md:border-l md:border-border md:pl-5">
                                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-text-tertiary">
                                    Datos personalizados
                                  </div>
                                  {customProps.length > 0 &&
                                  o.customFields &&
                                  customProps.some((p) => o.customFields?.[p.id]) ? (
                                    <dl className="flex flex-col gap-1 text-[12.5px]">
                                      {customProps
                                        .filter((p) => o.customFields?.[p.id])
                                        .map((p) => (
                                          <div key={p.id} className="flex gap-1.5">
                                            <dt className="text-text-tertiary">
                                              {p.name}:
                                            </dt>
                                            <dd className="font-medium text-navy">
                                              {o.customFields?.[p.id]}
                                            </dd>
                                          </div>
                                        ))}
                                    </dl>
                                  ) : (
                                    <p className="text-xs text-text-tertiary">
                                      Sin datos personalizados.
                                    </p>
                                  )}
                                  <div className="mt-3 flex gap-2">
                                    <Link to="/mapa" className={ghostLinkClass}>
                                      <MapPin
                                        aria-hidden="true"
                                        className="h-3 w-3"
                                        strokeWidth={2}
                                      />
                                      Ver en mapa
                                    </Link>
                                    <a
                                      href={`tel:${o.customerPhone}`}
                                      className={ghostLinkClass}
                                    >
                                      <Phone
                                        aria-hidden="true"
                                        className="h-3 w-3"
                                        strokeWidth={2}
                                      />
                                      Llamar
                                    </a>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {orders.length === 0 && (
                    <tr>
                      <td colSpan={7}>
                        <EmptyState
                          phrase="Entregas rápidas, operaciones inteligentes."
                          action={
                            <Button onClick={() => setShowForm(true)}>
                              Nuevo pedido
                            </Button>
                          }
                        >
                          Sin pedidos aún. Cree el primero o importe un CSV.
                        </EmptyState>
                      </td>
                    </tr>
                  )}
                  {orders.length > 0 && shown.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-text-tertiary">
                        Ningún pedido coincide con los filtros.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* Pie: conteo + leyenda de confianza de dirección + Ver más. */}
            {orders.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-2.5">
                <span className="flex flex-wrap items-center gap-3 text-xs text-text-tertiary">
                  <span>
                    Mostrando {shown.length}
                    {activeFilters ? ` de ${orders.length}` : ""} pedidos
                    {filterNote}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 rounded-full bg-lima"
                    />
                    confirmada
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 rounded-full bg-warning"
                    />
                    confianza media
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 rounded-full bg-danger"
                    />
                    errada / por corregir
                  </span>
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

      {/* Alta manual en drawer lateral (misma lógica de creación de siempre). */}
      <Drawer open={showForm} onClose={closeForm} title="Nuevo pedido">
        <form onSubmit={onCreate} className="grid grid-cols-1 gap-4">
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
          <Field label="Destinatario (quién recibe)">
            <input name="customerName" className={inputClass} required />
          </Field>
          <Field label="Teléfono del destinatario">
            <input name="customerPhone" className={inputClass} required placeholder="+57..." />
          </Field>
          <div>
            <Field label="Dirección (formal o informal)">
              <input
                name="addressRaw"
                className={inputClass}
                required
                placeholder='Ej: "Cra 13 # 54-20" o "frente al colegio San José"'
                onBlur={(e) => void validateAddress(e.target.value)}
              />
            </Field>
            {checkingAddress && (
              <p className="mt-1 text-xs text-text-tertiary">Verificando dirección…</p>
            )}
            {addressCheck && !checkingAddress && (
              <p
                className={`mt-1 flex items-start gap-1.5 rounded px-2 py-1 text-xs ${
                  addressCheck.knownAddress || !addressCheck.ambiguous
                    ? "bg-success-bg text-success"
                    : "bg-warning-bg text-warning"
                }`}
              >
                {addressCheck.knownAddress || !addressCheck.ambiguous ? (
                  <CheckCircle2
                    aria-hidden="true"
                    className="mt-px h-3.5 w-3.5 shrink-0"
                    strokeWidth={2}
                  />
                ) : (
                  <AlertTriangle
                    aria-hidden="true"
                    className="mt-px h-3.5 w-3.5 shrink-0"
                    strokeWidth={2}
                  />
                )}
                <span>
                  {addressCheck.knownAddress
                    ? "Dirección conocida: ya fue confirmada en entregas anteriores."
                    : addressCheck.ambiguous
                      ? 'Dirección ambigua. Revisa la nomenclatura o agrega una referencia (ej: "frente al colegio…") para evitar una entrega fallida.'
                      : "Dirección verificada."}
                </span>
              </p>
            )}
            {addressCheck &&
              !checkingAddress &&
              addressCheck.hasZones &&
              !addressCheck.serviceable && (
                <p className="mt-1 flex items-start gap-1.5 rounded bg-warning-bg px-2 py-1 text-xs text-warning">
                  <AlertTriangle
                    aria-hidden="true"
                    className="mt-px h-3.5 w-3.5 shrink-0"
                    strokeWidth={2}
                  />
                  <span>
                    Este destino está fuera de las zonas de cobertura. Puedes
                    crear el pedido, pero confírmalo con el cliente.
                  </span>
                </p>
              )}
          </div>
          <Field label="Referencias de entrega">
            <input name="addressNotes" className={inputClass} placeholder="Casa de portón verde…" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Peso (kg)">
              <input name="weightKg" type="number" step="0.1" defaultValue="1" className={inputClass} />
            </Field>
            <Field label="Servicio (promesa · SLA)">
              <select name="serviceId" className={inputClass} defaultValue="">
                <option value="">— Sin servicio —</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.identifier})
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {customProps.length > 0 && (
            <div className="grid grid-cols-1 gap-4 rounded-lg border border-border p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-text-tertiary">
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
          <Field label="Recogida en origen (opcional — para flujo pickup→entrega)">
            <input
              name="pickupAddressRaw"
              className={inputClass}
              placeholder="Bodega/tienda del cliente donde se recoge el paquete"
            />
          </Field>
          <Field label="Referencias de recogida">
            <input name="pickupNotes" className={inputClass} placeholder="Muelle 3, preguntar por despacho…" />
          </Field>
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button variant="secondary" onClick={closeForm}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary">
              Crear pedido
            </Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
}
