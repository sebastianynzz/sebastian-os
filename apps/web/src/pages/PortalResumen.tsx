import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useRealtimeReload } from "../realtime";
import { TrendChart } from "../components/charts";
import { Card, Loading, PageHeader, StatusBadge } from "../components/ui";

/**
 * Portal de clientes — "Resumen": el tablero del negocio. KPIs del mes, tasa
 * de éxito, envíos en curso y tendencia de 30 días, para que el cliente
 * entienda su operación completa de un vistazo.
 */

interface Summary {
  month: string;
  createdThisMonth: number;
  deliveredThisMonth: number;
  successRate: number | null;
  inTransit: number;
  byStatus: { status: string; count: number }[];
  byDay: { day: string; created: number; delivered: number }[];
}

export default function PortalResumen() {
  const [summary, setSummary] = useState<Summary | null>(null);

  async function load() {
    setSummary(await api<Summary>("GET", "/portal/summary"));
  }
  useEffect(() => {
    void load();
  }, []);
  // Tiempo real: el tablero se refresca cuando un envío cambia de estado.
  useRealtimeReload(["order"], () => void load());

  if (!summary) return <Loading label="Cargando su resumen…" />;

  const kpis = [
    { label: "Envíos este mes", value: String(summary.createdThisMonth) },
    { label: "Entregados este mes", value: String(summary.deliveredThisMonth) },
    {
      label: "Tasa de éxito",
      value:
        summary.successRate === null
          ? "—"
          : `${(summary.successRate * 100).toFixed(1)}%`,
    },
    { label: "En curso ahora", value: String(summary.inTransit) },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Resumen de mi operación"
        subtitle="Todo lo que tu operador mueve por ti, en una sola vista."
        actions={
          <Link
            to="/portal/nuevo"
            className="rounded-lg bg-lima px-4 py-2 text-sm font-semibold text-navy hover:brightness-95"
          >
            Nuevo envío
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <div className="text-2xl font-bold text-navy">{k.value}</div>
            <div className="text-xs text-navy/50">{k.label}</div>
          </Card>
        ))}
      </div>

      <Card title="Actividad de los últimos 30 días">
        <TrendChart
          days={summary.byDay.map((d) => d.day)}
          series={[
            {
              label: "Entregados",
              values: summary.byDay.map((d) => d.delivered),
            },
            { label: "Creados", values: summary.byDay.map((d) => d.created) },
          ]}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Mis envíos por estado">
          {summary.byStatus.length === 0 ? (
            <p className="text-sm text-navy/50">
              Aún no tienes envíos. Crea el primero en «Nuevo envío».
            </p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {summary.byStatus.map((s) => (
                <div
                  key={s.status}
                  className="flex items-center gap-2 rounded-lg border border-niebla px-3 py-2"
                >
                  <StatusBadge status={s.status} />
                  <span className="text-lg font-bold">{s.count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Accesos rápidos">
          <div className="flex flex-col gap-2 text-sm">
            <Link to="/portal/envios" className="text-navy underline-offset-2 hover:underline">
              → Ver todos mis envíos y su historial
            </Link>
            <Link to="/portal/verde" className="text-navy underline-offset-2 hover:underline">
              → Informe verde: el CO₂ que ahorras con tu operador
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
