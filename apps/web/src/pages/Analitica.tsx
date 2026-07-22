import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, MapPinned, TrendingDown, TrendingUp } from "lucide-react";
import { FAIL_REASON_LABELS, type FailReason } from "@moveos/shared";
import { api, ApiError } from "../api";
import { TrendChart } from "../components/charts";
import {
  Button,
  Card,
  KpiCard,
  Loading,
  ModuleDisabled,
  PageHeader,
  StatusBadge,
  inputClass,
  theadRowClass,
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
interface CostReport {
  routes: number;
  stops: number;
  totalKm: number;
  totalKwh: number;
  routeHours: number;
  laborCostCop: number;
  energyCostCop: number;
  totalCostCop: number;
  costPerDeliveryCop: number | null;
}

/** Miles con espacio fino (estilo del mock: «2 614», «$ 1 214 400»). */
function miles(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
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

const MONTHS_ES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];
/** «2026-06-23» → «23 jun» (eje X del mock, monoespaciado). */
function formatDayEs(day: string): string {
  const m = Number(day.slice(5, 7));
  const d = Number(day.slice(8, 10));
  return `${d} ${MONTHS_ES[m - 1] ?? ""}`;
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

/** Δ vs período anterior; `null` = sin dato previo comparable (se omite). */
type Trend = { dir: "up" | "down" | "flat"; text: string };
function countTrend(cur: number, prev: number): Trend {
  if (cur === prev) return { dir: "flat", text: "" };
  if (prev === 0) return { dir: "up", text: "nuevo" };
  const pct = Math.abs(((cur - prev) / prev) * 100);
  return { dir: cur > prev ? "up" : "down", text: `${pct.toFixed(0)}%` };
}
function rateTrend(cur: number | null, prev: number | null): Trend | null {
  if (cur === null || prev === null) return null;
  const diff = (cur - prev) * 100;
  if (Math.abs(diff) < 0.05) return { dir: "flat", text: "" };
  return { dir: diff > 0 ? "up" : "down", text: `${Math.abs(diff).toFixed(1)} pp` };
}

/** Línea Δ del KPI: flecha lucide 12px + magnitud + «vs ant.» atenuado. */
function Delta({ trend, hero = false }: { trend: Trend; hero?: boolean }) {
  const dimCls = hero ? "text-cielo/70" : "text-text-tertiary";
  if (trend.dir === "flat") {
    return <span className={dimCls}>— vs ant.</span>;
  }
  const up = trend.dir === "up";
  const mainCls = hero
    ? up
      ? "text-lima"
      : "text-danger-bg"
    : up
      ? "text-success"
      : "text-danger";
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-flex items-center gap-0.5 font-semibold ${mainCls}`}>
        <Icon size={12} strokeWidth={2} aria-hidden="true" />
        <span className="sr-only">{up ? "sube" : "baja"} </span>
        {trend.text}
      </span>
      <span className={dimCls}>vs ant.</span>
    </span>
  );
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
  const [cost, setCost] = useState<CostReport | null>(null);
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
      const [c, p, s, f, cst] = await Promise.all([
        api<Timeseries>("GET", `/analytics/timeseries?from=${from}&to=${to}`),
        api<Timeseries>(
          "GET",
          `/analytics/timeseries?from=${prevFrom}&to=${prevTo}`,
        ),
        api<SlaReport>("GET", `/analytics/sla-report?from=${from}&to=${to}`),
        api<FailureReport>("GET", `/analytics/failures?from=${from}&to=${to}`),
        api<CostReport>("GET", `/analytics/cost?from=${from}&to=${to}`),
      ]);
      setCur(c.days);
      setPrev(p.days);
      setSla(s);
      setFailures(f);
      setCost(cst);
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

  const historico = [
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
    { label: "Distancia total", value: `${miles(summary.totalDistanceKm)} km` },
    { label: "CO₂ estimado", value: `${miles(summary.estimatedCo2Kg)} kg` },
  ];

  const days = cur ?? [];
  const dates = days.map((d) => d.date);
  const tasaTrend = prevSum
    ? rateTrend(curSum?.successRate ?? null, prevSum.successRate)
    : null;

  return (
    <div className="space-y-3">
      <PageHeader
        title="Analítica"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1.5" role="group" aria-label="Rango rápido">
              {PRESETS.map((r) => {
                const active = len === r.days && to === todayBogota();
                return (
                  <button
                    key={r.days}
                    onClick={() => applyPreset(r.days)}
                    aria-pressed={active}
                    className={`rounded-md px-2.5 py-1 text-xs transition duration-200 ease-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${
                      active
                        ? "bg-navy font-semibold text-white"
                        : "border border-border bg-surface font-medium text-text-secondary hover:border-border-strong hover:text-navy"
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
              className={`${inputClass} max-w-[150px]`}
              aria-label="Desde"
            />
            <input
              type="date"
              value={to}
              min={from}
              max={todayBogota()}
              onChange={(e) => setTo(e.target.value)}
              className={`${inputClass} max-w-[150px]`}
              aria-label="Hasta"
            />
            <Button
              variant="secondary"
              icon={<Download strokeWidth={2} aria-hidden="true" />}
              onClick={exportCsv}
              disabled={!cur || !!rangeError}
            >
              CSV
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

      {/* KPIs del rango con Δ vs el período inmediatamente anterior; sin dato
          previo comparable, el Δ se omite (nunca se inventa). */}
      {curSum && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <KpiCard
            label="Creados"
            value={miles(curSum.created)}
            hint={
              prevSum ? (
                <Delta trend={countTrend(curSum.created, prevSum.created)} />
              ) : undefined
            }
          />
          <KpiCard
            label="Entregados"
            value={miles(curSum.delivered)}
            hint={
              prevSum ? (
                <Delta trend={countTrend(curSum.delivered, prevSum.delivered)} />
              ) : undefined
            }
          />
          <KpiCard
            label="Tasa entrega"
            tone="hero"
            value={
              curSum.successRate === null
                ? "—"
                : `${(curSum.successRate * 100).toFixed(0)}%`
            }
            hint={tasaTrend ? <Delta trend={tasaTrend} hero /> : undefined}
          />
          <KpiCard
            label="Distancia"
            value={
              <>
                {miles(curSum.distanceKm)}{" "}
                <span className="text-[12px] font-medium text-text-tertiary">km</span>
              </>
            }
            hint={
              prevSum ? (
                <Delta trend={countTrend(curSum.distanceKm, prevSum.distanceKm)} />
              ) : undefined
            }
          />
          <KpiCard
            label="CO₂ evitado"
            accent
            value={
              <>
                {miles(curSum.co2SavedKg)}{" "}
                <span className="text-[12px] font-medium text-text-tertiary">kg</span>
              </>
            }
            hint={
              prevSum ? (
                <Delta trend={countTrend(curSum.co2SavedKg, prevSum.co2SavedKg)} />
              ) : undefined
            }
          />
        </div>
      )}

      {cur === null ? (
        <Loading label="Cargando tendencias…" />
      ) : curSum && curSum.created === 0 && curSum.delivered === 0 ? (
        <Card>
          <p className="text-sm text-text-secondary">
            Sin actividad en el rango seleccionado.
          </p>
        </Card>
      ) : (
        <>
          <Card
            title={`Pedidos por día · ${len} días`}
            actions={
              <div className="flex items-center gap-3 text-[11px] text-text-secondary">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="h-[3px] w-2.5 rounded-[2px] bg-navy"
                  />
                  Creados
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="h-[3px] w-2.5 rounded-[2px] bg-olive"
                  />
                  Entregados
                </span>
              </div>
            }
          >
            <TrendChart
              days={dates}
              hideLegend
              axisMono
              xLabelCount={5}
              heightClass="h-[120px]"
              formatDay={formatDayEs}
              series={[
                {
                  label: "Creados",
                  values: days.map((d) => d.ordersCreated),
                  color: "var(--color-navy)",
                  fill: "var(--color-navy)",
                  fillOpacity: 0.08,
                  strokeWidth: 2.5,
                },
                {
                  label: "Entregados",
                  values: days.map((d) => d.ordersDelivered),
                  color: "var(--color-olive)",
                  strokeWidth: 2.5,
                },
              ]}
            />
          </Card>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card title="Distancia recorrida por día">
              <TrendChart
                days={dates}
                unit=" km"
                axisMono
                xLabelCount={5}
                formatDay={formatDayEs}
                series={[
                  { label: "Distancia", values: days.map((d) => d.totalDistanceKm) },
                ]}
              />
            </Card>
            <Card title="CO₂ por día">
              <TrendChart
                days={dates}
                unit=" kg"
                axisMono
                xLabelCount={5}
                formatDay={formatDayEs}
                series={[
                  { label: "CO₂ emitido", values: days.map((d) => d.co2Kg) },
                  { label: "CO₂ ahorrado", values: days.map((d) => d.co2SavedKg) },
                ]}
              />
            </Card>
          </div>
        </>
      )}

      {sla && sla.totals.total > 0 && <SlaByClientCard report={sla} rangeDays={len} />}

      {((failures && failures.total > 0) || (cost && cost.stops > 0)) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {failures && failures.total > 0 && <FailureCard report={failures} />}
          {cost && cost.stops > 0 && <CostCard report={cost} />}
        </div>
      )}

      <Card title="Indicadores acumulados (histórico)">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {historico.map((k) => (
            <div key={k.label}>
              <div className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
                {k.label}
              </div>
              <div className="mt-1 text-[23px] font-semibold leading-tight text-navy">
                {k.value}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Pedidos por estado">
        <div className="flex flex-wrap gap-3">
          {summary.ordersByStatus.map((s) => (
            <div
              key={s.status}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
            >
              <StatusBadge status={s.status} />
              <span className="text-lg font-semibold text-navy">{s.count}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/**
 * Semaforización del % incumplido (spec 2d): >10% peligro, >3% advertencia,
 * de resto éxito (barra en oliva, cifra en verde oscuro legible).
 */
function breachLevel(rate: number | null): {
  text: string;
  textCls: string;
  barCls: string;
  width: number;
} {
  if (rate === null) {
    return { text: "—", textCls: "text-text-tertiary", barCls: "bg-border", width: 0 };
  }
  const pct = rate * 100;
  const [textCls, barCls]: [string, string] =
    pct > 10
      ? ["text-danger", "bg-danger"]
      : pct > 3
        ? ["text-warning", "bg-warning"]
        : ["text-success", "bg-olive"];
  // Escala visual del mock: ~45% incumplido llena la barra de 44px.
  return {
    text: `${pct.toFixed(0)}%`,
    textCls,
    barCls,
    width: Math.min(100, pct * 2.2),
  };
}

/**
 * Cumplimiento de SLA por negocio cliente, ordenado por riesgo (mayor %
 * incumplido primero) con mini barra proporcional. Argumento B2B directo.
 */
function SlaByClientCard({
  report,
  rangeDays,
}: {
  report: SlaReport;
  rangeDays: number;
}) {
  const rows = [...report.byClient].sort(
    (a, b) => (b.breachRate ?? -1) - (a.breachRate ?? -1),
  );
  return (
    <Card title="Cumplimiento de SLA por cliente">
      <p className="mb-2 text-[11px] text-text-tertiary">
        Promesa del servicio desde la creación del pedido · rango {rangeDays} días
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px] text-navy">
          <thead>
            <tr className={theadRowClass}>
              <th className="py-1 pr-4 font-semibold">Negocio</th>
              <th className="py-1 pr-4 text-right font-semibold">Total</th>
              <th className="py-1 pr-4 text-right font-semibold">A tiempo</th>
              <th className="py-1 pr-4 text-right font-semibold">Incumpl.</th>
              <th className="w-[110px] py-1 text-right font-semibold">% incumplido</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const level = breachLevel(r.breachRate);
              return (
                <tr key={r.clientId ?? "__none__"} className="border-b border-border/60">
                  <td className="py-1.5 pr-4 font-medium">{r.clientName}</td>
                  <td className="py-1.5 pr-4 text-right">{r.total}</td>
                  <td className="py-1.5 pr-4 text-right text-success">{r.onTime}</td>
                  <td className="py-1.5 pr-4 text-right text-danger">{r.breached}</td>
                  <td className="py-1.5 text-right">
                    <span className="inline-flex items-center justify-end gap-1.5">
                      <span
                        aria-hidden="true"
                        className="h-[5px] w-11 overflow-hidden rounded-full bg-niebla"
                      >
                        <span
                          className={`block h-full ${level.barCls}`}
                          style={{ width: `${level.width}%` }}
                        />
                      </span>
                      <span className={`font-bold ${level.textCls}`}>{level.text}</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/**
 * Costo por entrega ENERGÍA-NATIVO: horas × costo/hora del conductor + kWh ×
 * tarifa de energía, dividido entre las entregas. La unidad de costo es la
 * energía, nunca el combustible (restricción dura 1.7). Tarjeta héroe navy.
 */
function CostCard({ report }: { report: CostReport }) {
  return (
    <div className="rounded-xl border border-navy bg-navy p-4 text-white shadow-soft transition duration-200 ease-brand hover:-translate-y-[2px] hover:shadow-soft-lg">
      <h2 className="text-sm font-semibold">Costo por entrega</h2>
      <p className="mt-0.5 text-[10.5px] text-cielo">
        energía-nativo: horas × costo/h + kWh × tarifa
      </p>
      <div className="mt-2 text-[26px] font-bold leading-tight tracking-[-0.02em] text-lima">
        {report.costPerDeliveryCop === null ? (
          "—"
        ) : (
          <>
            $ {miles(report.costPerDeliveryCop)}{" "}
            <span className="text-xs font-medium text-cielo">COP</span>
          </>
        )}
      </div>
      <div className="mt-2.5 flex flex-col gap-1 text-[11.5px] text-white/85">
        <div className="flex justify-between gap-3">
          <span>Mano de obra</span>
          <span className="font-mono">$ {miles(report.laborCostCop)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span>Energía · {miles(report.totalKwh)} kWh</span>
          <span className="font-mono">$ {miles(report.energyCostCop)}</span>
        </div>
        <div className="mt-0.5 flex justify-between gap-3 border-t border-white/15 pt-1">
          <span>
            {report.stops} {report.stops === 1 ? "entrega" : "entregas"}
          </span>
          <span className="font-mono">$ {miles(report.totalCostCop)}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Análisis de fallos: distribución de entregas fallidas por motivo, con barras
 * horizontales en peligro al 60%. Si «Dirección errada» domina, la tarjeta
 * ofrece la acción directa de abrir el triage de direcciones (grafo/moat).
 */
function FailureCard({ report }: { report: FailureReport }) {
  const rows = [...report.byReason].sort((a, b) => b.count - a.count);
  const top = rows[0];
  const max = top?.count ?? 1;
  const showTriage = top !== undefined && top.count > 0 && top.reason === "DIRECCION_ERRADA";
  return (
    <Card title={`Análisis de fallos (${report.total})`}>
      <div className="flex flex-col gap-[7px] text-xs text-navy">
        {rows.map((r) => (
          <div key={r.reason} className="flex items-center gap-2">
            <span
              className="w-32 shrink-0 truncate text-text-secondary"
              title={FAIL_REASON_LABELS[r.reason]}
            >
              {FAIL_REASON_LABELS[r.reason]}
            </span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-niebla">
              <span
                className="block h-full bg-danger/60"
                style={{ width: `${(r.count / max) * 100}%` }}
              />
            </span>
            <span className="shrink-0 font-mono text-[11px] text-text-secondary">
              {r.count} · {(r.pct * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
      {showTriage && (
        <Link
          to="/direcciones"
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-navy/25 bg-surface px-3 py-1.5 text-[11.5px] font-semibold text-navy transition duration-200 ease-brand hover:bg-lima/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
        >
          <MapPinned size={14} strokeWidth={1.75} aria-hidden="true" />
          Dirección errada domina → abrir triage de direcciones
        </Link>
      )}
    </Card>
  );
}
