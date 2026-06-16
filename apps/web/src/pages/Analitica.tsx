import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { TrendChart } from "../components/charts";
import {
  Card,
  Loading,
  ModuleDisabled,
  PageHeader,
  StatusBadge,
} from "../components/ui";
import { AiOptimizeButton } from "../components/AiOptimizeButton";

interface Summary {
  ordersByStatus: { status: string; count: number }[];
  deliverySuccessRate: number | null;
  routesPlanned: number;
  stopsPerRoute: number | null;
  stopsPerHour: number | null;
  totalDistanceKm: number;
  estimatedCo2Kg: number;
}

interface DayPoint {
  date: string;
  ordersCreated: number;
  ordersDelivered: number;
  ordersFailed: number;
  routesPlanned: number;
  stopsCompleted: number;
  totalDistanceKm: number;
  co2Kg: number;
  co2SavedKg: number;
  successRate: number | null;
}

interface Timeseries {
  from: string;
  to: string;
  days: DayPoint[];
}

const RANGES = [
  { days: 7, label: "7 días" },
  { days: 30, label: "30 días" },
  { days: 90, label: "90 días" },
];

export default function Analitica() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [serie, setSerie] = useState<Timeseries | null>(null);
  const [rangeDays, setRangeDays] = useState(30);
  const [moduleOff, setModuleOff] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setSummary(await api<Summary>("GET", "/analytics/summary"));
      } catch (err) {
        if (err instanceof ApiError && err.code === "MODULE_NOT_ENABLED") {
          setModuleOff(true);
        }
      }
    })();
  }, []);

  useEffect(() => {
    if (moduleOff) return;
    void (async () => {
      try {
        const to = new Date(Date.now() - 5 * 3600 * 1000) // día Bogotá (UTC-5)
          .toISOString()
          .slice(0, 10);
        const fromDate = new Date(`${to}T12:00:00Z`);
        fromDate.setUTCDate(fromDate.getUTCDate() - (rangeDays - 1));
        const from = fromDate.toISOString().slice(0, 10);
        setSerie(
          await api<Timeseries>(
            "GET",
            `/analytics/timeseries?from=${from}&to=${to}`,
          ),
        );
      } catch (err) {
        if (err instanceof ApiError && err.code === "MODULE_NOT_ENABLED") {
          setModuleOff(true);
        }
      }
    })();
  }, [rangeDays, moduleOff]);

  if (moduleOff) {
    return <ModuleDisabled title="Analítica" moduleName="Analítica Pro" />;
  }
  if (!summary) return <Loading label="Cargando indicadores…" />;

  const kpis = [
    {
      label: "Tasa de entrega exitosa",
      value:
        summary.deliverySuccessRate === null
          ? "—"
          : `${(summary.deliverySuccessRate * 100).toFixed(1)}%`,
    },
    { label: "Rutas planificadas", value: String(summary.routesPlanned) },
    {
      label: "Paradas por ruta (SPR)",
      value: summary.stopsPerRoute === null ? "—" : String(summary.stopsPerRoute),
    },
    {
      label: "Paradas por hora (SPH)",
      value: summary.stopsPerHour === null ? "—" : String(summary.stopsPerHour),
    },
    { label: "Distancia total", value: `${summary.totalDistanceKm.toFixed(1)} km` },
    { label: "CO₂ estimado", value: `${summary.estimatedCo2Kg} kg` },
  ];

  const days = serie?.days ?? [];
  const dates = days.map((d) => d.date);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Analítica"
        actions={
          <div className="flex gap-1" role="group" aria-label="Rango de fechas">
            {RANGES.map((r) => (
              <button
                key={r.days}
                onClick={() => setRangeDays(r.days)}
                aria-pressed={rangeDays === r.days}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  rangeDays === r.days
                    ? "bg-navy text-white"
                    : "bg-white text-navy/70 border border-cielo hover:bg-niebla"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      {/* Planeación de capacidad (asesor): recomienda flota + conductores para
          el pronóstico de demanda y los compara con la flota actual. */}
      <AiOptimizeButton actionId="plan_capacity" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {kpis.map((k) => (
          <Card key={k.label}>
            <div className="text-xs uppercase tracking-wide text-navy/50">{k.label}</div>
            <div className="mt-1 text-2xl font-bold">{k.value}</div>
          </Card>
        ))}
      </div>

      {serie === null ? (
        <Loading label="Cargando tendencias…" />
      ) : (
        <>
          <Card title={`Pedidos por día (${rangeDays} días)`}>
            <TrendChart
              days={dates}
              series={[
                { label: "Entregados", values: days.map((d) => d.ordersDelivered) },
                { label: "Creados", values: days.map((d) => d.ordersCreated) },
              ]}
            />
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Distancia recorrida por día">
              <TrendChart
                days={dates}
                unit=" km"
                series={[
                  {
                    label: "Distancia",
                    values: days.map((d) => d.totalDistanceKm),
                  },
                ]}
              />
            </Card>
            <Card title="CO₂ por día">
              <TrendChart
                days={dates}
                unit=" kg"
                series={[
                  { label: "CO₂ emitido", values: days.map((d) => d.co2Kg) },
                  { label: "CO₂ ahorrado", values: days.map((d) => d.co2SavedKg) },
                ]}
              />
            </Card>
          </div>
        </>
      )}

      <Card title="Pedidos por estado">
        <div className="flex flex-wrap gap-3">
          {summary.ordersByStatus.map((s) => (
            <div key={s.status} className="flex items-center gap-2 rounded-lg border border-niebla px-3 py-2">
              <StatusBadge status={s.status} />
              <span className="text-lg font-bold">{s.count}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
