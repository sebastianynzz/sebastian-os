import { useEffect, useState } from "react";
import { api } from "../api";
import { TrendChart } from "../components/charts";
import { Card } from "../components/ui";

interface Metrics {
  tenants: { total: number; active: number; suspended: number; byPlan: { plan: string; count: number }[] };
  orders: { total: number; deliverySuccessRate: number | null; byDay: { day: string; count: number }[] };
  moduleAdoption: { moduleKey: string; nombre: string; enabledCount: number; tenantCount: number }[];
}

interface DayPoint {
  date: string;
  ordersCreated: number;
  ordersDelivered: number;
}

export default function Metricas() {
  const [m, setM] = useState<Metrics | null>(null);
  const [serie, setSerie] = useState<DayPoint[] | null>(null);

  useEffect(() => {
    void api<Metrics>("GET", "/metrics").then(setM);
    void api<{ days: DayPoint[] }>("GET", "/metrics/timeseries").then((r) =>
      setSerie(r.days),
    );
  }, []);

  if (!m) return <p className="text-cielo">Cargando…</p>;

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
        <Card title="Pedidos por día (30 días, toda la plataforma)">
          {serie === null ? (
            <p className="text-sm text-white/30">Cargando…</p>
          ) : (
            <TrendChart
              days={serie.map((d) => d.date)}
              series={[
                { label: "Entregados", values: serie.map((d) => d.ordersDelivered) },
                { label: "Creados", values: serie.map((d) => d.ordersCreated) },
              ]}
            />
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
