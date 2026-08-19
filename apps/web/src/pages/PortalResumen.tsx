import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Leaf, PackageSearch, Plus } from "lucide-react";
import { api } from "../api";
import { useRealtimeReload } from "../realtime";
import { TrendChart } from "../components/charts";
import { Banner, Card, KpiCard, Loading, PageHeader, StatusBadge } from "../components/ui";

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

/** Enlace fantasma del revamp: blanco, borde navy 25 %, ícono inicial. */
const ghostLinkClass =
  "inline-flex items-center gap-1.5 rounded-md border border-asfalto/25 bg-surface px-3 py-1.5 text-sm font-medium text-asfalto transition duration-200 ease-brand hover:bg-verde/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-asfalto";

export default function PortalResumen() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    // Sin este catch, un rechazo del endpoint (p. ej. 403 "Requiere una cuenta
    // del portal de clientes" al entrar con una sesión que no es del portal)
    // dejaba el spinner girando para siempre en vez de decir qué pasó.
    try {
      setSummary(await api<Summary>("GET", "/portal/summary"));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el resumen");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  // Tiempo real: el tablero se refresca cuando un envío cambia de estado.
  useRealtimeReload(["order"], () => void load());

  if (error) return <Banner kind="error">{error}</Banner>;
  if (!summary) return <Loading label="Cargando tu resumen…" />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Resumen de mi operación"
        subtitle="Todo lo que tu operador mueve por ti, en una sola vista."
        actions={
          <Link
            to="/portal/nuevo"
            className="inline-flex items-center gap-1.5 rounded-md bg-verde px-3 py-1.5 text-sm font-semibold text-asfalto shadow-glow transition duration-200 ease-brand hover:bg-verde-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-asfalto"
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
            Nuevo envío
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Envíos este mes" value={summary.createdThisMonth} />
        <KpiCard label="Entregados este mes" value={summary.deliveredThisMonth} accent />
        <KpiCard
          label="Tasa de éxito"
          value={
            summary.successRate === null
              ? "—"
              : `${(summary.successRate * 100).toFixed(1)}%`
          }
        />
        <KpiCard label="En curso ahora" value={summary.inTransit} tone="hero" />
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
            <p className="text-sm text-text-secondary">
              Aún no tienes envíos. Crea el primero en «Nuevo envío».
            </p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {summary.byStatus.map((s) => (
                <div
                  key={s.status}
                  className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <StatusBadge status={s.status} />
                  <span className="text-lg font-semibold text-asfalto">{s.count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Accesos rápidos">
          <div className="flex flex-wrap gap-2">
            <Link to="/portal/envios" className={ghostLinkClass}>
              <PackageSearch aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
              Ver todos mis envíos y su historial
            </Link>
            <Link to="/portal/verde" className={ghostLinkClass}>
              <Leaf aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
              Informe verde: el CO₂ que ahorras con tu operador
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
