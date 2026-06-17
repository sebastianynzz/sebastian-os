import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
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
  createdAt: string;
}

interface ClientOption {
  id: string;
  name: string;
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
  ASSIGNED: "Asignado a ruta",
  DISPATCHED: "Despachado",
  IN_TRANSIT: "En camino",
  ARRIVED: "Conductor en el punto",
  DELIVERED: "Entregado",
  FAILED: "Entrega fallida",
  NOTIFIED: "Negocio notificado",
};

const CSV_TEMPLATE =
  "customerName,customerPhone,addressRaw,addressNotes,weightKg\n" +
  'Laura Martínez,+573101000001,"Cra 13 # 54-20, Chapinero",Portón verde,2\n' +
  'Pedro Sánchez,+573101000002,"Cl 72 # 10-34",,1.2\n';

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
  const fileRef = useRef<HTMLInputElement>(null);

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
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
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
      const payload = rows.map((r) => ({
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        addressRaw: r.addressRaw,
        addressNotes: r.addressNotes || undefined,
        weightKg: r.weightKg ? Number(r.weightKg) : undefined,
      }));
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
    try {
      await api("POST", "/orders", {
        clientId: data.get("clientId") || undefined,
        customerName: data.get("customerName"),
        customerPhone: data.get("customerPhone"),
        addressRaw: data.get("addressRaw"),
        addressNotes: data.get("addressNotes") || undefined,
        weightKg: Number(data.get("weightKg") || 1),
        pickupAddressRaw: data.get("pickupAddressRaw") || undefined,
        pickupNotes: data.get("pickupNotes") || undefined,
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
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
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
            <div />
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
              <th>Destinatario</th>
              <th>Dirección</th>
              <th>Peso</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
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
                    <td colSpan={6} className="px-4 py-3">
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
                <td colSpan={6}>
                  <EmptyState
                    action={
                      <Button onClick={() => setShowForm(true)}>Nuevo pedido</Button>
                    }
                  >
                    Sin pedidos aún. Cree el primero o importe un CSV.
                  </EmptyState>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        {(hasMore || orders.length > PAGE_SIZE) && (
          <div className="mt-3 flex items-center justify-between gap-3 text-sm text-navy/60">
            <span>Mostrando {orders.length} pedidos</span>
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
