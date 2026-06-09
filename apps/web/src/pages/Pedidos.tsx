import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import {
  Button,
  Card,
  Field,
  StatusBadge,
  formatCop,
  inputClass,
} from "../components/ui";

interface Order {
  id: string;
  trackingNumber: string | null;
  customerName: string;
  customerPhone: string;
  addressRaw: string;
  status: string;
  paymentType: string;
  codAmount: number | null;
  weightKg: number;
  geocodeSource: string | null;
  createdAt: string;
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
  COD_COLLECTED: "Recaudo COD",
  NOTIFIED: "Cliente notificado",
};

const CSV_TEMPLATE =
  "customerName,customerPhone,addressRaw,addressNotes,weightKg,paymentType,codAmount\n" +
  'Laura Martínez,+573101000001,"Cra 13 # 54-20, Chapinero",Portón verde,2,COD,89000\n' +
  'Pedro Sánchez,+573101000002,"Cl 72 # 10-34",,1.2,PREPAID,\n';

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

export default function Pedidos() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, OrderEvent[]>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setOrders(await api<Order[]>("GET", "/orders"));
  }
  useEffect(() => {
    void load();
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
    try {
      const rows = parseCsv(await file.text());
      if (rows.length === 0) throw new Error("El archivo no tiene filas de datos");
      const payload = rows.map((r) => ({
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        addressRaw: r.addressRaw,
        addressNotes: r.addressNotes || undefined,
        weightKg: r.weightKg ? Number(r.weightKg) : undefined,
        paymentType: r.paymentType === "COD" ? "COD" : "PREPAID",
        codAmount: r.codAmount ? Number(r.codAmount) : undefined,
      }));
      const res = await api<{ created: number }>("POST", "/orders/bulk", payload);
      setNotice(`${res.created} pedidos importados correctamente`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error importando CSV");
    }
  }

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const data = new FormData(e.currentTarget);
    const paymentType = data.get("paymentType") as string;
    try {
      await api("POST", "/orders", {
        customerName: data.get("customerName"),
        customerPhone: data.get("customerPhone"),
        addressRaw: data.get("addressRaw"),
        addressNotes: data.get("addressNotes") || undefined,
        weightKg: Number(data.get("weightKg") || 1),
        paymentType,
        codAmount:
          paymentType === "COD" ? Number(data.get("codAmount")) : undefined,
      });
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Pedidos</h1>
        <div className="flex gap-2">
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
        </div>
      </div>
      {notice && <p className="text-sm font-medium text-navy">✓ {notice}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {showForm && (
        <Card title="Nuevo pedido">
          <form onSubmit={onCreate} className="grid grid-cols-2 gap-4">
            <Field label="Cliente">
              <input name="customerName" className={inputClass} required />
            </Field>
            <Field label="Teléfono (WhatsApp)">
              <input name="customerPhone" className={inputClass} required placeholder="+57..." />
            </Field>
            <div className="col-span-2">
              <Field label="Dirección (formal o informal)">
                <input
                  name="addressRaw"
                  className={inputClass}
                  required
                  placeholder='Ej: "Cra 13 # 54-20" o "frente al colegio San José"'
                />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="Referencias de entrega">
                <input name="addressNotes" className={inputClass} placeholder="Casa de portón verde…" />
              </Field>
            </div>
            <Field label="Peso (kg)">
              <input name="weightKg" type="number" step="0.1" defaultValue="1" className={inputClass} />
            </Field>
            <Field label="Pago">
              <select name="paymentType" className={inputClass}>
                <option value="PREPAID">Prepagado</option>
                <option value="COD">Contra-entrega (COD)</option>
              </select>
            </Field>
            <Field label="Monto COD (COP)">
              <input name="codAmount" type="number" className={inputClass} placeholder="0" />
            </Field>
            <div className="col-span-2">
              <Button type="submit">Crear pedido</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-cielo/40 text-left text-xs uppercase text-navy/50">
              <th className="py-2">Guía</th>
              <th>Cliente</th>
              <th>Dirección</th>
              <th>Pago</th>
              <th>Peso</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <Fragment key={o.id}>
                <tr
                  className="cursor-pointer border-b border-niebla hover:bg-niebla/60"
                  onClick={() => void toggleBitacora(o.id)}
                >
                  <td className="py-2 font-mono text-xs font-semibold">
                    {o.trackingNumber ?? "—"}
                  </td>
                  <td>
                    <div className="font-medium">{o.customerName}</div>
                    <div className="text-xs text-navy/50">{o.customerPhone}</div>
                  </td>
                  <td className="max-w-xs truncate">{o.addressRaw}</td>
                  <td>
                    {o.paymentType === "COD" ? (
                      <span className="font-medium text-amber-700">
                        COD {o.codAmount ? formatCop(o.codAmount) : ""}
                      </span>
                    ) : (
                      "Prepagado"
                    )}
                  </td>
                  <td>{o.weightKg} kg</td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                </tr>
                {expanded === o.id && (
                  <tr className="border-b border-niebla bg-niebla/40">
                    <td colSpan={6} className="px-4 py-3">
                      <div className="text-xs font-semibold uppercase text-navy/50">
                        Bitácora del pedido
                      </div>
                      <ol className="mt-2 space-y-1">
                        {(events[o.id] ?? []).map((ev) => (
                          <li key={ev.id} className="flex items-baseline gap-3 text-sm">
                            <span className="font-mono text-xs text-navy/50">
                              {new Date(ev.createdAt).toLocaleString("es-CO", {
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
                <td colSpan={6} className="py-8 text-center text-navy/40">
                  Sin pedidos aún. Cree el primero, importe un CSV o cargue el seed demo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
