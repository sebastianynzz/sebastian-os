/**
 * Gráficas SVG sin dependencias (convención del repo: dependencias mínimas).
 * `TrendChart` dibuja hasta dos series diarias sobre el mismo eje; el tooltip
 * nativo (<title>) muestra los valores del día. Paleta Move: serie principal
 * navy con área lima, comparativa en cielo.
 */

export interface TrendSeries {
  label: string;
  values: number[];
  /** Color del trazo (CSS). */
  color?: string;
  /** Relleno del área bajo la curva (CSS); solo la serie principal lo usa. */
  fill?: string;
  /** Opacidad del área bajo la curva (por defecto 0.35). */
  fillOpacity?: number;
  /** Grosor del trazo (por defecto 2). */
  strokeWidth?: number;
}

const W = 600;
const H = 200;
const PAD_TOP = 12;

const DEFAULT_COLORS = ["#233955", "#a7b6c4"]; // navy, cielo

export function TrendChart({
  days,
  series,
  unit = "",
  formatDay = (d) => d.slice(5),
  hideLegend = false,
  axisMono = false,
  xLabelCount = 3,
  heightClass = "h-40",
}: {
  days: string[];
  series: TrendSeries[];
  /** Sufijo de unidad en el tooltip (p. ej. " km"). */
  unit?: string;
  formatDay?: (day: string) => string;
  /** Oculta la fila de leyenda/máximo (cuando la tarjeta trae leyenda propia). */
  hideLegend?: boolean;
  /** Etiquetas del eje X en monoespaciada (patrón del revamp). */
  axisMono?: boolean;
  /** Cantidad de etiquetas del eje X (por defecto 3: inicio, centro y fin). */
  xLabelCount?: number;
  /** Alto del SVG como clase Tailwind (por defecto `h-40`). */
  heightClass?: string;
}) {
  const n = days.length;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => H - (v / max) * (H - PAD_TOP);
  const fmt = (v: number) =>
    `${Number.isInteger(v) ? v : v.toFixed(1)}${unit}`;

  const toPoints = (values: number[]) =>
    values.map((v, i) => `${x(i)},${y(v)}`).join(" ");

  // Etiquetas del eje X repartidas uniformemente (por defecto inicio/centro/fin).
  const k = Math.max(2, xLabelCount);
  const xLabels =
    n <= k
      ? days
      : Array.from(
          { length: k },
          (_, i) => days[Math.floor((i * (n - 1)) / (k - 1))],
        );

  return (
    <div>
      {!hideLegend && (
        <div className="mb-1 flex items-center justify-between text-xs">
          <div className="flex flex-wrap gap-3">
            {series.map((s, idx) => (
              <span key={s.label} className="flex items-center gap-1.5 opacity-80">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full"
                  style={{ background: s.color ?? DEFAULT_COLORS[idx] }}
                />
                {s.label}
              </span>
            ))}
          </div>
          <span className="opacity-50">máx {fmt(max)}</span>
        </div>
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className={`${heightClass} w-full`}
        role="img"
        aria-label={series.map((s) => s.label).join(" y ")}
      >
        {/* Línea base y guía media. */}
        <line x1={0} y1={H} x2={W} y2={H} stroke="currentColor" strokeOpacity={0.15} />
        <line
          x1={0}
          y1={y(max / 2)}
          x2={W}
          y2={y(max / 2)}
          stroke="currentColor"
          strokeOpacity={0.08}
          strokeDasharray="4 4"
        />
        {series.map((s, idx) => (
          <g key={s.label}>
            {idx === 0 && s.fill !== "none" && n > 1 && (
              <polygon
                points={`0,${H} ${toPoints(s.values)} ${W},${H}`}
                fill={s.fill ?? "#cfdd80"}
                fillOpacity={s.fillOpacity ?? 0.35}
              />
            )}
            <polyline
              points={toPoints(s.values)}
              fill="none"
              stroke={s.color ?? DEFAULT_COLORS[idx]}
              strokeWidth={s.strokeWidth ?? 2}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </g>
        ))}
        {/* Zonas de hover por día con tooltip nativo. */}
        {days.map((day, i) => (
          <rect
            key={day}
            x={n <= 1 ? 0 : (i - 0.5) * (W / (n - 1))}
            y={0}
            width={n <= 1 ? W : W / (n - 1)}
            height={H}
            fill="transparent"
          >
            <title>
              {`${day}\n${series.map((s) => `${s.label}: ${fmt(s.values[i] ?? 0)}`).join("\n")}`}
            </title>
          </rect>
        ))}
      </svg>
      <div
        className={`mt-1 flex justify-between text-[10px] ${
          axisMono ? "font-mono text-text-tertiary" : "opacity-50"
        }`}
      >
        {xLabels.map((d, i) => (
          <span key={`${d}-${i}`}>{d ? formatDay(d) : ""}</span>
        ))}
      </div>
    </div>
  );
}
