import { useCallback, useEffect, useMemo, useState } from "react";
import { formatNumber } from "@moveos/shared";
import { api } from "../api";
import { TrendChart } from "../components/charts";
import { Card, inputClass } from "../components/ui";

/**
 * Métricas de plataforma con rango de fechas (Bogotá), comparación período a
 * período y drill-down por tenant. Las cifras del rango se derivan de la serie
 * diaria (`/metrics/timeseries`, que ya acota por from/to/tenantId y trae
 * successRate); `/metrics` aporta los hechos estructurales de la plataforma
 * (conteo de tenants, planes, adopción de módulos).
 */

interface DayPoint {
  date: string;
  ordersCreated: number;
  ordersDelivered: number;
  ordersFailed: number;
  routesPlanned: number;
  stopsCompleted: number;
  totalDistanceKm: number;
  totalDurationMin: number;
  activeDrivers: number;
  co2Kg: number;
  co2SavedKg: number;
  successRate: number | null;
}
interface Timeseries {
  tenantId?: string;
  from: string;
  to: string;
  days: DayPoint[];
}
interface PlatformMetrics {
  tenants: {
    total: number;
    active: number;
    suspended: number;
    byPlan: { plan: string; count: number }[];
  };
  moduleAdoption: {
    moduleKey: string;
    nombre: string;
    enabledCount: number;
    tenantCount: number;
  }[];
}
interface TenantRef {
  id: string;
  name: string;
  status: string;
}

// --- Fechas en Bogotá (UTC-5 fijo, sin horario de verano) ---
function todayBogota(): string {
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Días inclusivos entre from y to. */
function rangeLength(from: string, to: string): number {
  return (
    Math.round(
      (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000,
    ) + 1
  );
}

interface Summary {
  created: number;
  delivered: number;
  failed: number;
  successRate: number | null;
  distanceKm: number;
  co2SavedKg: number;
  routesPlanned: number;
  stopsCompleted: number;
  activeDriversPeak: number;
}
function summarize(days: DayPoint[]): Summary {
  const s = days.reduce(
    (a, d) => {
      a.created += d.ordersCreated;
      a.delivered += d.ordersDelivered;
      a.failed += d.ordersFailed;
      a.distanceKm += d.totalDistanceKm;
      a.co2SavedKg += d.co2SavedKg;
      a.routesPlanned += d.routesPlanned;
      a.stopsCompleted += d.stopsCompleted;
      a.activeDriversPeak = Math.max(a.activeDriversPeak, d.activeDrivers);
      return a;
    },
    {
      created: 0,
      delivered: 0,
      failed: 0,
      distanceKm: 0,
      co2SavedKg: 0,
      routesPlanned: 0,
      stopsCompleted: 0,
      activeDriversPeak: 0,
    },
  );
  const attempted = s.delivered + s.failed;
  return {
    ...s,
    successRate: attempted === 0 ? null : s.delivered / attempted,
  };
}

type Trend = { text: string; cls: string };
/** Variación relativa de un conteo (más es mejor). */
function countTrend(cur: number, prev: number): Trend {
  if (cur === prev) return { text: "—", cls: "text-white/30" };
  if (prev === 0) return { text: "▲ nuevo", cls: "text-lima" };
  const pct = ((cur - prev) / prev) * 100;
  const up = cur > prev;
  return {
    text: `${up ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)}%`,
    cls: up ? "text-lima" : "text-red-400",
  };
}
/** Variación en puntos porcentuales de la tasa de entrega. */
function rateTrend(cur: number | null, prev: number | null): Trend {
  if (cur === null || prev === null) return { text: "—", cls: "text-white/30" };
  const diff = (cur - prev) * 100;
  if (Math.abs(diff) < 0.05) return { text: "—", cls: "text-white/30" };
  const up = diff > 0;
  return {
    text: `${up ? "▲" : "▼"} ${Math.abs(diff).toFixed(1)} pp`,
    cls: up ? "text-lima" : "text-red-400",
  };
}

const PRESETS = [
  { label: "7 días", days: 7 },
  { label: "30 días", days: 30 },
  { label: "90 días", days: 90 },
];

export default function Metricas() {
  const [tenantId, setTenantId] = useState("");
  const [from, setFrom] = useState(() => addDays(todayBogota(), -29));
  const [to, setTo] = useState(() => todayBogota());

  const [tenants, setTenants] = useState<TenantRef[]>([]);
  const [platform, setPlatform] = useState<PlatformMetrics | null>(null);
  const [cur, setCur] = useState<DayPoint[] | null>(null);
  const [prev, setPrev] = useState<DayPoint[] | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const len = rangeLength(from, to);
  const rangeError =
    from > to
      ? "La fecha inicial debe ser anterior o igual a la final."
      : len > 92
        ? "Rango máximo: 92 días."
        : null;

  // Catálogo de tenants + hechos estructurales (no dependen del rango).
  useEffect(() => {
    void api<TenantRef[]>("GET", "/tenants").then(setTenants).catch(() => {});
    void api<PlatformMetrics>("GET", "/metrics").then(setPlatform).catch(() => {});
  }, []);

  const loadSeries = useCallback(async () => {
    if (rangeError) return;
    setRefreshing(true);
    setError(false);
    const tq = tenantId ? `&tenantId=${tenantId}` : "";
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(from, -len);
    try {
      const [c, p] = await Promise.all([
        api<Timeseries>("GET", `/metrics/timeseries?from=${from}&to=${to}${tq}`),
        api<Timeseries>(
          "GET",
          `/metrics/timeseries?from=${prevFrom}&to=${prevTo}${tq}`,
        ),
      ]);
      setCur(c.days);
      setPrev(p.days);
    } catch {
      setError(true);
    } finally {
      setRefreshing(false);
    }
  }, [from, to, tenantId, len, rangeError]);

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

  const tenantName = tenants.find((t) => t.id === tenantId)?.name;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Métricas de plataforma</h1>
          <p className="text-sm text-cielo">
            {tenantId
              ? `Salud operativa de ${tenantName ?? "tenant"} · ${from} → ${to}`
              : `Toda la plataforma · ${from} → ${to}`}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {PRESETS.map((p) => {
            const active = len === p.days && to === todayBogota();
            return (
              <button
                key={p.days}
                onClick={() => applyPreset(p.days)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                  active
                    ? "bg-lima text-navy"
                    : "bg-white/10 text-niebla hover:bg-white/20"
                }`}
              >
                {p.label}
              </button>
            );
          })}
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className={`${inputClass} w-auto [color-scheme:dark]`}
          />
          <input
            type="date"
            value={to}
            min={from}
            max={todayBogota()}
            onChange={(e) => setTo(e.target.value)}
            className={`${inputClass} w-auto [color-scheme:dark]`}
          />
          <select
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            className={`${inputClass} w-auto`}
          >
            <option value="">Toda la plataforma</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.status !== "ACTIVE" ? " (suspendido)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {rangeError && (
        <Card>
          <p className="text-sm text-amber-300">{rangeError}</p>
        </Card>
      )}

      {error && (
        <Card>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-red-300">No se pudieron cargar las métricas.</span>
            <button
              onClick={() => void loadSeries()}
              className="rounded-lg bg-lima px-3 py-1.5 font-semibold text-navy"
            >
              Reintentar
            </button>
          </div>
        </Card>
      )}

      {!curSum ? (
        <Card>
          <p className="py-8 text-center text-cielo">Cargando métricas…</p>
        </Card>
      ) : (
        <>
          {/* KPIs del rango con Δ vs período anterior. */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat
              label="Pedidos creados"
              value={formatNumber(curSum.created)}
              delta={prevSum && countTrend(curSum.created, prevSum.created)}
            />
            <Stat
              label="Entregados"
              value={formatNumber(curSum.delivered)}
              delta={prevSum && countTrend(curSum.delivered, prevSum.delivered)}
            />
            <Stat
              label="Tasa de entrega"
              value={
                curSum.successRate === null
                  ? "—"
                  : `${(curSum.successRate * 100).toFixed(0)}%`
              }
              delta={prevSum && rateTrend(curSum.successRate, prevSum.successRate)}
            />
            <Stat
              label="CO₂ evitado"
              value={`${formatNumber(curSum.co2SavedKg, { maximumFractionDigits: 0 })} kg`}
              delta={prevSum && countTrend(curSum.co2SavedKg, prevSum.co2SavedKg)}
            />
          </div>

          {curSum.created === 0 && curSum.delivered === 0 && (
            <Card>
              <p className="text-sm text-cielo">
                Sin actividad de pedidos en el rango seleccionado.
              </p>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={`Pedidos por día${refreshing ? " · actualizando…" : ""}`}>
              <TrendChart
                days={cur!.map((d) => d.date)}
                series={[
                  { label: "Entregados", values: cur!.map((d) => d.ordersDelivered) },
                  { label: "Creados", values: cur!.map((d) => d.ordersCreated) },
                ]}
              />
            </Card>

            <Card title="Tasa de entrega por día">
              <TrendChart
                unit="%"
                days={cur!.map((d) => d.date)}
                series={[
                  {
                    label: "Tasa de entrega",
                    values: cur!.map((d) =>
                      d.successRate === null ? 0 : Math.round(d.successRate * 100),
                    ),
                  },
                ]}
              />
            </Card>
          </div>

          {tenantId ? (
            <Card title="Operación del tenant (rango)">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <MiniStat
                  label="Rutas planificadas"
                  value={formatNumber(curSum.routesPlanned)}
                />
                <MiniStat
                  label="Paradas completadas"
                  value={formatNumber(curSum.stopsCompleted)}
                />
                <MiniStat
                  label="Distancia"
                  value={`${formatNumber(curSum.distanceKm, { maximumFractionDigits: 0 })} km`}
                />
                <MiniStat
                  label="Conductores activos (pico)"
                  value={formatNumber(curSum.activeDriversPeak)}
                />
              </div>
            </Card>
          ) : (
            <Card title="Adopción de módulos (plataforma)">
              {platform === null ? (
                <p className="text-sm text-white/30">Cargando…</p>
              ) : (
                <div className="space-y-2">
                  {platform.moduleAdoption.map((a) => (
                    <div key={a.moduleKey}>
                      <div className="flex justify-between text-xs">
                        <span>{a.nombre}</span>
                        <span className="text-cielo">
                          {a.enabledCount}/{a.tenantCount}
                        </span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-cielo"
                          style={{
                            width: `${a.tenantCount === 0 ? 0 : (a.enabledCount / a.tenantCount) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Stat({
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
      <div className="text-xs uppercase text-cielo/60">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {delta && (
        <div className={`mt-0.5 text-xs ${delta.cls}`}>
          {delta.text} <span className="text-white/30">vs período anterior</span>
        </div>
      )}
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase text-cielo/60">{label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  );
}
