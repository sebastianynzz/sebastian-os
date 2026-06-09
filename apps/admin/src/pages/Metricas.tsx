import { useEffect, useState } from "react";
import { api } from "../api";
import { Card } from "../components/ui";

interface Metrics {
  tenants: { total: number; active: number; suspended: number; byPlan: { plan: string; count: number }[] };
  orders: { total: number; deliverySuccessRate: number | null; byDay: { day: string; count: number }[] };
  moduleAdoption: { moduleKey: string; nombre: string; enabledCount: number; tenantCount: number }[];
}

export default function Metricas() {
  const [m, setM] = useState<Metrics | null>(null);

  useEffect(() => {
    void api<Metrics>("GET", "/metrics").then(setM);
  }, []);

  if (!m) return <p className="text-cielo">Cargando…</p>;

  const maxDay = Math.max(1, ...m.orders.byDay.map((d) => d.count));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Métricas de plataforma</h1>

      <div className="grid grid-cols-4 gap-4">
        <Stat label="Tenants" value={String(m.tenants.total)} sub={`${m.tenants.active} activos · ${m.tenants.suspended} suspendidos`} />
        <Stat label="Pedidos totales" value={String(m.orders.total)} />
        <Stat
          label="Tasa de entrega"
          value={m.orders.deliverySuccessRate === null ? "—" : `${(m.orders.deliverySuccessRate * 100).toFixed(0)}%`}
        />
        <Stat label="Planes" value={m.tenants.byPlan.map((p) => `${p.count} ${p.plan}`).join(" · ") || "—"} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title="Pedidos por día (14 días)">
          {m.orders.byDay.length === 0 ? (
            <p className="text-sm text-white/30">Sin datos.</p>
          ) : (
            <div className="flex h-40 items-end gap-1">
              {m.orders.byDay.map((d) => (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${d.day}: ${d.count}`}>
                  <div
                    className="w-full rounded-t bg-lima"
                    style={{ height: `${(d.count / maxDay) * 100}%`, minHeight: 2 }}
                  />
                  <span className="text-[9px] text-white/30">{d.day.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Adopción de módulos">
          <div className="space-y-2">
            {m.moduleAdoption.map((a) => (
              <div key={a.moduleKey}>
                <div className="flex justify-between text-xs">
                  <span>{a.nombre}</span>
                  <span className="text-cielo">{a.enabledCount}/{a.tenantCount}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-cielo"
                    style={{ width: `${a.tenantCount === 0 ? 0 : (a.enabledCount / a.tenantCount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <div className="text-xs uppercase text-cielo/60">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-white/30">{sub}</div>}
    </Card>
  );
}
