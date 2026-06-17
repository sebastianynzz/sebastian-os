import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import { TrendChart } from "../components/charts";
import {
  Button,
  Card,
  Loading,
  ModuleDisabled,
  PageHeader,
  StatusBadge,
  inputClass,
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

// --- Fechas en Bogotá (UTC-5 fijo) ---
function todayBogota(): string {
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function rangeLength(from: string, to: string): number {
  return (
    Math.round(
      (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000,
    ) + 1
  );
}

interface RangeSummary {
  created: number;
  delivered: number;
  failed: number;
  successRate: number | null;
  distanceKm: number;
  co2SavedKg: number;
}
function summarize(days: DayPoint[]): RangeSummary {
  const s = days.reduce(
    (a, d) => {
      a.created += d.ordersCreated;
      a.delivered += d.ordersDelivered;
      a.failed += d.ordersFailed;
      a.distanceKm += d.totalDistanceKm;
      a.co2SavedKg += d.co2SavedKg;
      return a;
    },
    { created: 0, delivered: 0, failed: 0, distanceKm: 0, co2SavedKg: 0 },
  );
  const attempted = s.delivered + s.failed;
  return { ...s, successRate: attempted === 0 ? null : s.delivered / attempted };
}

type Trend = { text: string; cls: string };
function countTrend(cur: number, prev: number): Trend {
  if (cur === prev) return { text: "—", cls: "text-navy/40" };
  if (prev === 0) return { text: "▲ nuevo", cls: "text-success" };
  const pct = ((cur - prev) / prev) * 100;
  const up = cur > prev;
  return {
    text: `${up ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)}%`,
    cls: up ? "text-success" : "text-danger",
  };
}
function rateTrend(cur: number | null, prev: number | null): Trend {
  if (cur === null || prev === null) return { text: "—", cls: "text-navy/40" };
  const diff = (cur - prev) * 100;
  if (Math.abs(diff) < 0.05) return { text: "—", cls: "text-navy/40" };
  const up = diff > 0;
  return {
    text: `${up ? "▲" : "▼"} ${Math.abs(diff).toFixed(1)} pp`,
    cls: up ? "text-success" : "text-danger",
  };
}

const PRESETS = [
  { days: 7, label: "7 días" },
  { days: 30, label: "30 días" },
  { days: 90, label: "90 días" },
];

function seriesToCsv(days: DayPoint[]): string {
  const header = [
    "fecha",
    "creados",
    "entregados",
    "fallidos",
    "rutas",
    "paradas_completadas",
    "distancia_km",
    "co2_kg",
    "co2_evitado_kg",
    "tasa_entrega_pct",
  ];
  const lines = [header.join(",")];
  for (const d of days) {
    lines.push(
      [
        d.date,
        d.ordersCreated,
        d.ordersDelivered,
        d.ordersFailed,
        d.routesPlanned,
        d.stopsCompleted,
        d.totalDistanceKm,
        d.co2Kg,
        d.co2SavedKg,
        d.successRate === null ? "" : (d.successRate * 100).toFixed(1),
      ].join(","),
    );
  }
  // BOM para que Excel reconozca UTF-8.
  return "﻿" + lines.join("\n");
}

export default function Analitica() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cur, setCur] = useState<DayPoint[] | null>(null);
  const [prev, setPrev] = useState<DayPoint[] | null>(null);
  const [from, setFrom] = useState(() => addDays(todayBogota(), -29));
  const [to, setTo] = useState(() => todayBogota());
  const [moduleOff, setModuleOff] = useState(false);
  const [error, setError] = useState(false);

  const len = rangeLength(from, to);
  const rangeError =
    from > to
      ? "La fecha inicial debe ser anterior o igual a la final."
      : len > 92
        ? "Rango máximo: 92 días."
        : null;

  useEffect(() => {
    void (async () => {
      try {
        setSummary(await api<Summary>("GET", "/analytics/summary"));
      } catch (err) {
        if (err instanceof ApiError && err.code === "MODULE_NOT_ENABLED") {
          setModuleOff(true);
        } else {
          setError(true);
        }
      }
    })();
  }, []);

  const loadSeries = useCallback(async () => {
    if (moduleOff || rangeError) return;
    setError(false);
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(from, -len);
    try {
      const [c, p] = await Promise.all([
        api<Timeseries>("GET", `/analytics/timeseries?from=${from}&to=${to}`),
        api<Timeseries>(
          "GET",
          `/analytics/timeseries?from=${prevFrom}&to=${prevTo}`,
        ),
      ]);
      setCur(c.days);
      setPrev(p.days);
    } catch (err) {
      if (err instanceof ApiError && err.code === "MODULE_NOT_ENABLED") {
        setModuleOff(true);
      } else {
        setError(true);
      }
    }
  }, [from, to, len, moduleOff, rangeError]);

  useEffect(() => {
    void loadSeries();
  }, [loadSeries]);

  const curSum = useMemo(() => (cur ? summarize(cur) : null), [cur]);
  const prevSum = useMemo(() => (prev ? summarize(prev) : null), [prev]);

  function applyPreset(days: number) {
    const t = todayBogota();
    setFrom(addDays(t, -(days - 1)));
    setTo(t);
  }
  function exportCsv() {
    if (!cur) return;
    const blob = new Blob([seriesToCsv(cur)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analitica-${from}_a_${to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  if (moduleOff) {
    return <ModuleDisabled title="Analítica" moduleName="Analítica Pro" />;
  }
  if (!summary) return <Loading label="Cargando indicadores…" />;

  const kpis = [
    {
      label: "Tasa de entrega (histórico)",
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

  const days = cur ?? [];
  const dates = days.map((d) => d.date);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Analítica"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1" role="group" aria-label="Rango rápido">
              {PRESETS.map((r) => {
                const active = len === r.days && to === todayBogota();
                return (
                  <button
                    key={r.days}
                    onClick={() => applyPreset(r.days)}
                    aria-pressed={active}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                      active
                        ? "bg-navy text-white"
                        : "border border-cielo bg-white text-navy/70 hover:bg-niebla"
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className={inputClass}
              aria-label="Desde"
            />
            <input
              type="date"
              value={to}
              min={from}
              max={todayBogota()}
              onChange={(e) => setTo(e.target.value)}
              className={inputClass}
              aria-label="Hasta"
            />
            <Button variant="secondary" onClick={exportCsv} disabled={!cur || !!rangeError}>
              Exportar CSV
            </Button>
          </div>
        }
      />

      {/* Planeación de capacidad (asesor): recomienda flota + conductores para
          el pronóstico de demanda y los compara con la flota actual. */}
      <AiOptimizeButton actionId="plan_capacity" />

      {rangeError && (
        <Card>
          <p className="text-sm text-warning">{rangeError}</p>
        </Card>
      )}

      {error && (
        <Card>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-danger">No se pudieron cargar las tendencias.</span>
            <Button variant="secondary" onClick={() => void loadSeries()}>
              Reintentar
            </Button>
          </div>
        </Card>
      )}

      {/* KPIs del rango con Δ vs el período inmediatamente anterior. */}
      {curSum && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <RangeStat
            label="Pedidos creados"
            value={String(curSum.created)}
            delta={prevSum && countTrend(curSum.created, prevSum.created)}
          />
          <RangeStat
            label="Entregados"
            value={String(curSum.delivered)}
            delta={prevSum && countTrend(curSum.delivered, prevSum.delivered)}
          />
          <RangeStat
            label="Tasa de entrega"
            value={
              curSum.successRate === null
                ? "—"
                : `${(curSum.successRate * 100).toFixed(0)}%`
            }
            delta={prevSum && rateTrend(curSum.successRate, prevSum.successRate)}
          />
          <RangeStat
            label="Distancia"
            value={`${curSum.distanceKm.toFixed(0)} km`}
            delta={prevSum && countTrend(curSum.distanceKm, prevSum.distanceKm)}
          />
          <RangeStat
            label="CO₂ evitado"
            value={`${curSum.co2SavedKg.toFixed(0)} kg`}
            delta={prevSum && countTrend(curSum.co2SavedKg, prevSum.co2SavedKg)}
          />
        </div>
      )}

      {cur === null ? (
        <Loading label="Cargando tendencias…" />
      ) : curSum && curSum.created === 0 && curSum.delivered === 0 ? (
        <Card>
          <p className="text-sm text-navy/60">Sin actividad en el rango seleccionado.</p>
        </Card>
      ) : (
        <>
          <Card title={`Pedidos por día (${len} días)`}>
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
                  { label: "Distancia", values: days.map((d) => d.totalDistanceKm) },
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

      <Card title="Indicadores acumulados (histórico)">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {kpis.map((k) => (
            <div key={k.label}>
              <div className="text-xs uppercase tracking-wide text-navy/50">{k.label}</div>
              <div className="mt-1 text-2xl font-bold">{k.value}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Pedidos por estado">
        <div className="flex flex-wrap gap-3">
          {summary.ordersByStatus.map((s) => (
            <div
              key={s.status}
              className="flex items-center gap-2 rounded-lg border border-niebla px-3 py-2"
            >
              <StatusBadge status={s.status} />
              <span className="text-lg font-bold">{s.count}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function RangeStat({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: Trend | null;
}) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-navy/50">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {delta && (
        <div className={`mt-0.5 text-xs ${delta.cls}`}>
          {delta.text} <span className="text-navy/40">vs período anterior</span>
        </div>
      )}
    </Card>
  );
}
