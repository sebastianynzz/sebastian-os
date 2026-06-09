import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Button, Card, StatusBadge, formatCop, inputClass } from "../components/ui";

interface Summary {
  pendingByDriver: { driverId: string | null; driverName: string; amount: number; count: number }[];
  totalsByStatus: { status: string; amount: number; count: number }[];
}
interface Payment {
  id: string;
  amount: number;
  method: string;
  status: string;
  collectedAt: string;
  order: { customerName: string; addressRaw: string };
  driver: { name: string } | null;
}
interface Settlement {
  id: string;
  expectedAmount: number;
  receivedAmount: number;
  status: string;
  createdAt: string;
  driver: { name: string };
}

export default function Cod() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [received, setReceived] = useState<Record<string, string>>({});
  const [moduleOff, setModuleOff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [s, p, st] = await Promise.all([
        api<Summary>("GET", "/cod/summary"),
        api<Payment[]>("GET", "/cod/payments"),
        api<Settlement[]>("GET", "/cod/settlements"),
      ]);
      setSummary(s);
      setPayments(p);
      setSettlements(st);
    } catch (err) {
      if (err instanceof ApiError && err.code === "MODULE_NOT_ENABLED") {
        setModuleOff(true);
      }
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function settle(driverId: string) {
    setError(null);
    try {
      await api("POST", "/cod/settlements", {
        driverId,
        receivedAmount: Number(received[driverId] ?? 0),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    }
  }

  if (moduleOff) {
    return (
      <Card title="Contra-entrega">
        <p className="text-sm text-slate-500">
          El módulo COD no está activo para su empresa. Actívelo en la pestaña
          Módulos.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Contra-entrega (COD)</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-3 gap-4">
        {summary?.totalsByStatus.map((t) => (
          <Card key={t.status}>
            <div className="text-xs uppercase text-slate-400">
              <StatusBadge status={t.status} />
            </div>
            <div className="mt-2 text-2xl font-bold">{formatCop(t.amount)}</div>
            <div className="text-xs text-slate-500">{t.count} recaudos</div>
          </Card>
        ))}
        {(summary?.totalsByStatus.length ?? 0) === 0 && (
          <Card>
            <p className="text-sm text-slate-400">Sin recaudos aún.</p>
          </Card>
        )}
      </div>

      <Card title="Efectivo en calle por conductor (pendiente de liquidar)">
        {summary?.pendingByDriver.length === 0 && (
          <p className="text-sm text-slate-400">Nada pendiente. Todo conciliado ✓</p>
        )}
        <div className="space-y-2">
          {summary?.pendingByDriver.map((d) => (
            <div
              key={d.driverId ?? "none"}
              className="flex items-center justify-between rounded-lg border border-slate-100 p-3"
            >
              <div>
                <div className="font-medium">{d.driverName}</div>
                <div className="text-xs text-slate-500">
                  {d.count} recaudos · esperado {formatCop(d.amount)}
                </div>
              </div>
              {d.driverId && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    placeholder="Monto recibido"
                    className={`${inputClass} w-40`}
                    value={received[d.driverId] ?? ""}
                    onChange={(e) =>
                      setReceived((r) => ({ ...r, [d.driverId!]: e.target.value }))
                    }
                  />
                  <Button onClick={() => settle(d.driverId!)}>Liquidar</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card title="Recaudos">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                <th className="py-1">Pedido</th>
                <th>Conductor</th>
                <th>Método</th>
                <th>Monto</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-slate-100">
                  <td className="max-w-[12rem] truncate py-1.5">{p.order.customerName}</td>
                  <td>{p.driver?.name ?? "—"}</td>
                  <td className="text-xs">{p.method}</td>
                  <td>{formatCop(p.amount)}</td>
                  <td><StatusBadge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Liquidaciones">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                <th className="py-1">Conductor</th>
                <th>Esperado</th>
                <th>Recibido</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {settlements.map((s) => (
                <tr key={s.id} className="border-b border-slate-100">
                  <td className="py-1.5">{s.driver.name}</td>
                  <td>{formatCop(s.expectedAmount)}</td>
                  <td>{formatCop(s.receivedAmount)}</td>
                  <td><StatusBadge status={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
