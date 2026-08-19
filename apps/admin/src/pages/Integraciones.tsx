import { useEffect, useState } from "react";
import { api } from "../api";
import { Card } from "../components/ui";

/**
 * Salud de integraciones (A2): la pantalla responde una sola pregunta de
 * operador — ¿qué está degradado AHORA? Lo roto va primero, lo no
 * configurado después, lo sano al final. Sin paneles de vanidad.
 */

type IntegrationStatus = "OK" | "DEGRADED" | "CONFIGURED" | "NOT_CONFIGURED";

interface IntegrationHealth {
  key: string;
  label: string;
  status: IntegrationStatus;
  latencyMs: number | null;
  detail: string;
}

const STATUS_ORDER: Record<IntegrationStatus, number> = {
  DEGRADED: 0,
  NOT_CONFIGURED: 1,
  CONFIGURED: 2,
  OK: 3,
};

const STATUS_UI: Record<
  IntegrationStatus,
  { dot: string; label: string; text: string }
> = {
  OK: { dot: "bg-emerald-400", label: "OK", text: "text-emerald-300" },
  DEGRADED: { dot: "bg-red-500", label: "Degradado", text: "text-red-400" },
  CONFIGURED: { dot: "bg-sky-400", label: "Configurado", text: "text-sky-300" },
  NOT_CONFIGURED: {
    dot: "bg-white/30",
    label: "Sin configurar",
    text: "text-white/40",
  },
};

export default function Integraciones() {
  const [results, setResults] = useState<IntegrationHealth[] | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function load(refresh = false) {
    setBusy(true);
    try {
      const res = await api<{ cachedAt: string; results: IntegrationHealth[] }>(
        "GET",
        `/integrations/health${refresh ? "?refresh=1" : ""}`,
      );
      setResults(res.results);
      setCachedAt(res.cachedAt);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    // Auto-refresco lento (60 s = TTL del caché del backend): la vista de
    // operación se mantiene al día sin clics. No es polling rápido.
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, []);

  const sorted = results
    ? [...results].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
    : null;
  const degraded = results?.filter((r) => r.status === "DEGRADED").length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Salud de integraciones</h1>
          <p className="text-sm text-gris-senal">
            {degraded > 0
              ? `⚠️ ${degraded} integración(es) degradada(s)`
              : "Todo lo configurado responde"}
            {cachedAt &&
              ` · verificado ${new Date(cachedAt).toLocaleTimeString("es-CO")}`}
            {error && results && " · no se pudo actualizar"}
          </p>
        </div>
        <button
          onClick={() => void load(true)}
          disabled={busy}
          className="rounded-lg bg-verde px-3 py-1.5 text-sm font-semibold text-asfalto hover:brightness-95 disabled:opacity-50"
        >
          {busy ? "Verificando…" : "Verificar ahora"}
        </button>
      </div>

      {!results && error && (
        <Card>
          <p className="text-sm text-red-400">
            No se pudo consultar la salud de integraciones.{" "}
            <button onClick={() => void load(true)} className="underline">
              Reintentar
            </button>
          </p>
        </Card>
      )}
      {!results && !error && <p className="text-gris-senal">Cargando…</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {sorted?.map((r) => {
          const ui = STATUS_UI[r.status];
          return (
            <Card key={r.key}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${ui.dot}`} />
                    <span className="font-semibold">{r.label}</span>
                  </div>
                  <p className="mt-1 text-xs text-gris-senal">{r.detail}</p>
                </div>
                <div className="shrink-0 text-right">
                  <div className={`text-xs font-bold ${ui.text}`}>{ui.label}</div>
                  {r.latencyMs !== null && (
                    <div className="text-[10px] text-white/40">{r.latencyMs} ms</div>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
