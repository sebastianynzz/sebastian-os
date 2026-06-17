import { useCallback, useEffect, useMemo, useState } from "react";
import { FAIL_REASON_LABELS, type FailReason } from "@moveos/shared";
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

interface ClientSlaRow {
  clientId: string | null;
  clientName: string;
  total: number;
  onTime: number;
  breached: number;
  pending: number;
  breachRate: number | null;
}
interface SlaReport {
  from: string;
  to: string;
  totals: Omit<ClientSlaRow, "clientId" | "clientName">;
  byClient: ClientSlaRow[];
}
interface FailureReport {
  from: string;
  to: string;
  total: number;
  byReason: { reason: FailReason; count: number; pct: number }[];
  byDay: { day: string; count: number }[];
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
  const [sla, setSla] = useState<SlaReport | null>(null);
  const [failures, setFailures] = useState<FailureReport | null>(null);
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
      const [c, p, s, f] = await Promise.all([
        api<Timeseries>("GET", `/analytics/timeseries?from=${from}&to=${to}`),
        api<Timeseries>(
          "GET",
          `/analytics/timeseries?from=${prevFrom}&to=${prevTo}`,
        ),
        api<SlaReport>("GET", `/analytics/sla-report?from=${from}&to=${to}`),
        api<FailureReport>("GET", `/analytics/failures?from=${from}&to=${to}`),
      ]);
      setCur(c.days);
      setPrev(p.days);
      setSla(s);
      setFailures(f);
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

      {sla && sla.totals.total > 0 && <SlaByClientCard report={sla} />}

      {failures && failures.total > 0 && <FailureCard report={failures} />}

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

/** Color del % de incumplimiento: verde ≤10%, ámbar ≤25%, rojo por encima. */
function breachRateStyle(rate: number | null): { text: string; cls: string } {
  if (rate === null) return { text: "—", cls: "text-navy/40" };
  const cls = rate <= 0.1 ? "text-success" : rate <= 0.25 ? "text-warning" : "text-danger";
  return { text: `${(rate * 100).toFixed(0)}%`, cls };
}

/**
 * Cumplimiento de SLA por negocio cliente: a tiempo / incumplidos / en curso y
 * la tasa de incumplimiento. Argumento B2B directo para cada comercio.
 */
function SlaByClientCard({ report }: { report: SlaReport }) {
  const t = report.totals;
  const totalRate = breachRateStyle(t.breachRate);
  return (
    <Card title="Cumplimiento de SLA por cliente">
      <p className="mb-3 text-xs text-navy/50">
        Pedidos con servicio (promesa de entrega) en el rango. La hora límite es
        el plazo del servicio desde la creación del pedido.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-niebla text-left text-xs uppercase tracking-wide text-navy/50">
              <th className="py-2 pr-4 font-medium">Negocio</th>
              <th className="py-2 pr-4 text-right font-medium">Total</th>
              <th className="py-2 pr-4 text-right font-medium">A tiempo</th>
              <th className="py-2 pr-4 text-right font-medium">Incumplidos</th>
              <th className="py-2 pr-4 text-right font-medium">En curso</th>
              <th className="py-2 text-right font-medium">% incumplido</th>
            </tr>
          </thead>
          <tbody>
            {report.byClient.map((r) => {
              const rate = breachRateStyle(r.breachRate);
              return (
                <tr key={r.clientId ?? "__none__"} className="border-b border-niebla/60">
                  <td className="py-2 pr-4 font-medium text-navy">{r.clientName}</td>
                  <td className="py-2 pr-4 text-right">{r.total}</td>
                  <td className="py-2 pr-4 text-right text-success">{r.onTime}</td>
                  <td className="py-2 pr-4 text-right text-danger">{r.breached}</td>
                  <td className="py-2 pr-4 text-right text-navy/60">{r.pending}</td>
                  <td className={`py-2 text-right font-semibold ${rate.cls}`}>{rate.text}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-navy/20 font-semibold">
              <td className="py-2 pr-4 text-navy">Total</td>
              <td className="py-2 pr-4 text-right">{t.total}</td>
              <td className="py-2 pr-4 text-right text-success">{t.onTime}</td>
              <td className="py-2 pr-4 text-right text-danger">{t.breached}</td>
              <td className="py-2 pr-4 text-right text-navy/60">{t.pending}</td>
              <td className={`py-2 text-right ${totalRate.cls}`}>{totalRate.text}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

/**
 * Análisis de fallos: distribución de entregas fallidas por motivo. Insumo
 * directo de mejora operativa; DIRECCION_ERRADA refuerza el grafo de direcciones.
 */
function FailureCard({ report }: { report: FailureReport }) {
  const max = Math.max(...report.byReason.map((r) => r.count), 1);
  return (
    <Card title={`Análisis de fallos (${report.total})`}>
      <p className="mb-3 text-xs text-navy/50">
        Entregas fallidas o rechazadas del rango, por motivo estandarizado.
      </p>
      <div className="space-y-2">
        {report.byReason.map((r) => (
          <div key={r.reason} className="flex items-center gap-3 text-sm">
            <span className="w-40 shrink-0 text-navy">
              {FAIL_REASON_LABELS[r.reason]}
            </span>
            <span className="h-3 flex-1 overflow-hidden rounded-full bg-niebla">
              <span
                className="block h-full rounded-full bg-danger/60"
                style={{ width: `${(r.count / max) * 100}%` }}
              />
            </span>
            <span className="w-20 shrink-0 text-right font-mono text-xs text-navy/60">
              {r.count} · {(r.pct * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </Card>
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
