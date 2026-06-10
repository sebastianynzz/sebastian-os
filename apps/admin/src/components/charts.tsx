/**
 * Gráficas SVG sin dependencias — variante del panel de plataforma (tema
 * oscuro): serie principal lima con área lima, comparativa en cielo. Misma
 * implementación que apps/web/src/components/charts.tsx (convención actual de
 * duplicación consciente hasta extraer @moveos/ui).
 */

export interface TrendSeries {
  label: string;
  values: number[];
  color?: string;
  fill?: string;
}

const W = 600;
const H = 200;
const PAD_TOP = 12;

const DEFAULT_COLORS = ["#d0de81", "#a2b2c8"]; // lima, cielo

export function TrendChart({
  days,
  series,
  unit = "",
  formatDay = (d) => d.slice(5),
}: {
  days: string[];
  series: TrendSeries[];
  unit?: string;
  formatDay?: (day: string) => string;
}) {
  const n = days.length;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => H - (v / max) * (H - PAD_TOP);
  const fmt = (v: number) =>
    `${Number.isInteger(v) ? v : v.toFixed(1)}${unit}`;

  const toPoints = (values: number[]) =>
    values.map((v, i) => `${x(i)},${y(v)}`).join(" ");

  const xLabels =
    n <= 2 ? days : [days[0], days[Math.floor((n - 1) / 2)], days[n - 1]];

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <div className="flex flex-wrap gap-3">
          {series.map((s, idx) => (
            <span key={s.label} className="flex items-center gap-1.5 text-cielo">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ background: s.color ?? DEFAULT_COLORS[idx] }}
              />
              {s.label}
            </span>
          ))}
        </div>
        <span className="text-white/30">máx {fmt(max)}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-40 w-full"
        role="img"
        aria-label={series.map((s) => s.label).join(" y ")}
      >
        <line x1={0} y1={H} x2={W} y2={H} stroke="white" strokeOpacity={0.15} />
        <line
          x1={0}
          y1={y(max / 2)}
          x2={W}
          y2={y(max / 2)}
          stroke="white"
          strokeOpacity={0.08}
          strokeDasharray="4 4"
        />
        {series.map((s, idx) => (
          <g key={s.label}>
            {idx === 0 && s.fill !== "none" && n > 1 && (
              <polygon
                points={`0,${H} ${toPoints(s.values)} ${W},${H}`}
                fill={s.fill ?? "#d0de81"}
                fillOpacity={0.2}
              />
            )}
            <polyline
              points={toPoints(s.values)}
              fill="none"
              stroke={s.color ?? DEFAULT_COLORS[idx]}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </g>
        ))}
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
      <div className="mt-1 flex justify-between text-[10px] text-white/30">
        {xLabels.map((d, i) => (
          <span key={`${d}-${i}`}>{d ? formatDay(d) : ""}</span>
        ))}
      </div>
    </div>
  );
}
