import { useEffect, useState } from "react";
import { api } from "../api";
import { Card } from "../components/ui";
import { TrendChart } from "../components/charts";

/**
 * Monitor del data flywheel: el cuarto de máquinas del moat. Muestra si el
 * grafo de direcciones está compounding — crecimiento de pines, graph hit
 * rate (cada acierto es una llamada a Google/Lupap que no se pagó) y
 * cobertura por ciudad/tenant.
 */

interface FlywheelData {
  costPerGeocodeUsd: number;
  graph: {
    totalPins: number;
    newPins7d: number;
    newPins30d: number;
    lifetimeReuses: number;
    lifetimeSavingsUsd: number;
    byCity: { city: string; pins: number }[];
    byTenant: { tenantId: string; name: string; pins: number; uses: number }[];
  };
  geocoding30d: {
    total: number;
    graphHits: number;
    paidCallsAvoided: number;
    estimatedSavingsUsd: number;
    paidProviderCalls: number;
    mockCalls: number;
    hitRate: number | null;
    bySource: { source: string; count: number }[];
  };
  daily: {
    day: string;
    geocodes: number;
    graphHits: number;
    hitRate: number | null;
    newPins: number;
  }[];
}

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

function usd(v: number): string {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function Flywheel() {
  const [data, setData] = useState<FlywheelData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    void api<FlywheelData>("GET", "/flywheel")
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) {
    return (
      <div className="py-10 text-center text-cielo">
        No se pudo cargar el monitor del flywheel. Reintenta en unos segundos.
      </div>
    );
  }
  if (!data) return <div className="py-10 text-center text-cielo">Cargando flywheel…</div>;

  const days = data.daily.map((d) => d.day);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-white">Data flywheel</h1>
        <p className="text-sm text-cielo">
          Crecimiento del grafo de direcciones y su unit economics: cada acierto
          del grafo es una geocodificación que no se pagó.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <div className="text-3xl font-bold text-lima">{data.graph.totalPins}</div>
          <div className="text-xs text-cielo">pines aprendidos (total)</div>
        </Card>
        <Card>
          <div className="text-3xl font-bold text-white">+{data.graph.newPins7d}</div>
          <div className="text-xs text-cielo">pines nuevos · 7 días</div>
        </Card>
        <Card>
          <div className="text-3xl font-bold text-white">{pct(data.geocoding30d.hitRate)}</div>
          <div className="text-xs text-cielo">graph hit rate · 30 días</div>
        </Card>
        <Card>
          <div className="text-3xl font-bold text-lima">
            {data.geocoding30d.paidCallsAvoided}
          </div>
          <div className="text-xs text-cielo">llamadas pagas evitadas · 30 días</div>
        </Card>
      </div>

      {/* Unit economics: el argumento de inversión — cada acierto del grafo es
          una llamada paga que no se hizo; el ahorro compone con el reuso. */}
      <Card title="Unit economics del grafo">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <div className="text-3xl font-bold text-lima">
              {usd(data.geocoding30d.estimatedSavingsUsd)}
            </div>
            <div className="text-xs text-cielo">ahorro estimado · 30 días</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-white">
              {usd(data.graph.lifetimeSavingsUsd)}
            </div>
            <div className="text-xs text-cielo">ahorro acumulado (vida del grafo)</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-white">
              {data.graph.lifetimeReuses.toLocaleString("es-CO")}
            </div>
            <div className="text-xs text-cielo">reusos del grafo (llamadas evitadas, total)</div>
          </div>
        </div>
        <p className="mt-3 text-xs text-cielo/60">
          Estimado a {usd(data.costPerGeocodeUsd)} por geocodificación (tarifa de
          referencia de Google Geocoding). Cada acierto del grafo es una llamada
          paga a Google/Lupap que no se realizó.
        </p>
      </Card>

      {days.length > 0 && (
        <Card title="Geocodificaciones vs aciertos del grafo (30 días)">
          <TrendChart
            days={days}
            series={[
              { label: "Aciertos del grafo", values: data.daily.map((d) => d.graphHits) },
              { label: "Geocodificaciones", values: data.daily.map((d) => d.geocodes) },
            ]}
          />
        </Card>
      )}

      {days.length > 0 && (
        <Card title="Pines nuevos por día (crecimiento del grafo)">
          <TrendChart
            days={days}
            series={[{ label: "Pines nuevos", values: data.daily.map((d) => d.newPins) }]}
          />
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Cobertura por ciudad">
          {data.graph.byCity.length === 0 ? (
            <p className="text-sm text-cielo">Aún no hay pines con ciudad registrada.</p>
          ) : (
            <table className="w-full text-sm text-white">
              <tbody>
                {data.graph.byCity.map((c) => (
                  <tr key={c.city} className="border-b border-white/10">
                    <td className="py-2">{c.city}</td>
                    <td className="py-2 text-right font-mono">{c.pins}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Grafo por tenant">
          {data.graph.byTenant.length === 0 ? (
            <p className="text-sm text-cielo">Aún no hay pines aprendidos.</p>
          ) : (
            <table className="w-full text-sm text-white">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase text-cielo">
                  <th className="py-2">Tenant</th>
                  <th className="py-2 text-right">Pines</th>
                  <th className="py-2 text-right">Reusos</th>
                </tr>
              </thead>
              <tbody>
                {data.graph.byTenant.map((t) => (
                  <tr key={t.tenantId} className="border-b border-white/10">
                    <td className="py-2">{t.name}</td>
                    <td className="py-2 text-right font-mono">{t.pins}</td>
                    <td className="py-2 text-right font-mono">{t.uses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card title="Fuentes de geocodificación (30 días)">
        <div className="flex flex-wrap gap-3 text-sm">
          {data.geocoding30d.bySource.map((s) => (
            <span
              key={s.source}
              className="rounded-full border border-white/15 px-3 py-1 text-cielo"
            >
              {s.source}: <span className="font-mono text-white">{s.count}</span>
            </span>
          ))}
          {data.geocoding30d.bySource.length === 0 && (
            <span className="text-cielo">Sin geocodificaciones registradas aún.</span>
          )}
        </div>
      </Card>
    </div>
  );
}
