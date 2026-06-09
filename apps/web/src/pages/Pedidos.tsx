import { useEffect, useState, type FormEvent } from "react";
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

export default function Pedidos() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setOrders(await api<Order[]>("GET", "/orders"));
  }
  useEffect(() => {
    void load();
  }, []);

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
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancelar" : "Nuevo pedido"}
        </Button>
      </div>

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
            {error && <p className="col-span-2 text-sm text-red-600">{error}</p>}
            <div className="col-span-2">
              <Button type="submit">Crear pedido</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
              <th className="py-2">Cliente</th>
              <th>Dirección</th>
              <th>Pago</th>
              <th>Peso</th>
              <th>Geocodificación</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-slate-100">
                <td className="py-2">
                  <div className="font-medium">{o.customerName}</div>
                  <div className="text-xs text-slate-400">{o.customerPhone}</div>
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
                <td className="text-xs text-slate-500">{o.geocodeSource ?? "—"}</td>
                <td>
                  <StatusBadge status={o.status} />
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400">
                  Sin pedidos aún. Cree el primero o cargue el seed demo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
