import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import {
  Card,
  Loading,
  ModuleDisabled,
  PageHeader,
  StatusBadge,
} from "../components/ui";

interface Summary {
  ordersByStatus: { status: string; count: number }[];
  deliverySuccessRate: number | null;
  routesPlanned: number;
  stopsPerRoute: number | null;
  stopsPerHour: number | null;
  totalDistanceKm: number;
  estimatedCo2Kg: number;
}

export default function Analitica() {
  const [summary, setSummary] = useState<Summary | null>(null);
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

  return (
    <div className="space-y-4">
      <PageHeader title="Analítica" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {kpis.map((k) => (
          <Card key={k.label}>
            <div className="text-xs uppercase tracking-wide text-navy/50">{k.label}</div>
            <div className="mt-1 text-2xl font-bold">{k.value}</div>
          </Card>
        ))}
      </div>
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
