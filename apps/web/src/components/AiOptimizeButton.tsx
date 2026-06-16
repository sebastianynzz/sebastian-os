import { useEffect, useState } from "react";
import type {
  ActionCatalogEntry,
  ApplyResult,
  OptimizationActionId,
  Proposal,
} from "@moveos/shared";
import { api, ApiError } from "../api";
import { Banner, Button, Card } from "./ui";

/**
 * Botón reutilizable "Optimizar con IA". Llama POST /ai/actions/:id/run, pinta
 * el panel de resultado desde la propuesta (resumen + impacto + sin asignar /
 * excluidos) y ofrece Aplicar (/apply) · Ajustar (re-ejecuta) · Descartar. Solo
 * se renderiza si la acción aparece en GET /ai/actions para el tenant/rol —
 * mismo contrato que el Copiloto, una sola ruta de aplicación.
 */

/** Catálogo de acciones disponibles (cacheado por sesión, una sola carga). */
let catalogCache: ActionCatalogEntry[] | null = null;
let catalogPromise: Promise<ActionCatalogEntry[]> | null = null;

async function loadCatalog(): Promise<ActionCatalogEntry[]> {
  if (catalogCache) return catalogCache;
  if (!catalogPromise) {
    catalogPromise = api<{ actions: ActionCatalogEntry[] }>("GET", "/ai/actions")
      .then((r) => {
        catalogCache = r.actions;
        return r.actions;
      })
      .catch(() => {
        // Módulo AI_ADDONS inactivo (403) u otro error → sin botones de IA.
        catalogCache = [];
        return [];
      });
  }
  return catalogPromise;
}

function useAction(actionId: OptimizationActionId): ActionCatalogEntry | null {
  const [entry, setEntry] = useState<ActionCatalogEntry | null>(null);
  useEffect(() => {
    let alive = true;
    void loadCatalog().then((actions) => {
      if (alive) setEntry(actions.find((a) => a.id === actionId) ?? null);
    });
    return () => {
      alive = false;
    };
  }, [actionId]);
  return entry;
}

function pct(n: number | undefined): string | null {
  return n == null ? null : `${Math.round(n)}%`;
}

function ImpactMetrics({ proposal }: { proposal: Proposal }) {
  const i = proposal.impact;
  const rows: { label: string; value: string }[] = [];
  if (i.distanceKm != null) rows.push({ label: "Distancia", value: `${i.distanceKm} km` });
  if (i.distanceDeltaKm != null)
    rows.push({ label: "Δ distancia", value: `${i.distanceDeltaKm} km` });
  if (i.vehiclesUsed != null)
    rows.push({ label: "Vehículos", value: String(i.vehiclesUsed) });
  if (i.energyKwh != null) rows.push({ label: "Energía", value: `${i.energyKwh} kWh` });
  if (pct(i.utilizationPct)) rows.push({ label: "Utilización", value: pct(i.utilizationPct)! });
  if (pct(i.timeInBandPct))
    rows.push({ label: "En banda (frío)", value: pct(i.timeInBandPct)! });
  if (i.costEstimateCop != null)
    rows.push({ label: "Costo est.", value: `$${i.costEstimateCop.toLocaleString("es-CO")}` });

  return (
    <div className="space-y-2 text-sm">
      {rows.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {rows.map((r) => (
            <span key={r.label}>
              <span className="text-navy/50">{r.label}: </span>
              <span className="font-medium text-navy">{r.value}</span>
            </span>
          ))}
        </div>
      )}
      {i.notesEs && i.notesEs.length > 0 && (
        <ul className="list-disc pl-5 text-navy/70">
          {i.notesEs.map((n, k) => (
            <li key={k}>{n}</li>
          ))}
        </ul>
      )}
      {i.unassigned && i.unassigned.length > 0 && (
        <div>
          <p className="font-medium text-amber-700">
            Sin asignar ({i.unassigned.length})
          </p>
          <ul className="list-disc pl-5 text-navy/70">
            {i.unassigned.slice(0, 6).map((u) => (
              <li key={u.orderId}>{u.reasonEs}</li>
            ))}
            {i.unassigned.length > 6 && <li>…</li>}
          </ul>
        </div>
      )}
      {i.excluded && i.excluded.length > 0 && (
        <div>
          <p className="font-medium text-amber-700">
            Vehículos excluidos ({i.excluded.length})
          </p>
          <ul className="list-disc pl-5 text-navy/70">
            {i.excluded.slice(0, 6).map((e) => (
              <li key={e.vehicleId}>{e.reasonEs}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export interface AiOptimizeButtonProps {
  actionId: OptimizationActionId;
  /** Contexto de la pantalla actual (selección): orderIds, vehicleIds, etc. */
  context?: {
    orderIds?: string[];
    vehicleIds?: string[];
    routeId?: string;
    date?: string;
    objective?: "cost" | "speed" | "balanced" | "coldchain_first";
    params?: Record<string, unknown>;
  };
  /** Se llama tras aplicar con éxito (para recargar la pantalla). */
  onApplied?: (result: ApplyResult) => void;
  /** Deshabilita el disparo (p. ej. selección vacía). */
  disabled?: boolean;
}

export function AiOptimizeButton({
  actionId,
  context,
  onApplied,
  disabled,
}: AiOptimizeButtonProps) {
  const action = useAction(actionId);
  const [phase, setPhase] = useState<"idle" | "running" | "applying">("idle");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Si la acción no está en el catálogo (módulo/rol), no se renderiza nada.
  if (!action) return null;

  async function run() {
    setPhase("running");
    setError(null);
    setProposal(null);
    try {
      const p = await api<Proposal>("POST", `/ai/actions/${actionId}/run`, context ?? {});
      setProposal(p);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo generar la propuesta");
    } finally {
      setPhase("idle");
    }
  }

  async function apply() {
    if (!proposal) return;
    setPhase("applying");
    setError(null);
    try {
      const result = await api<ApplyResult>(
        "POST",
        `/ai/actions/${actionId}/apply`,
        { proposalId: proposal.proposalId },
      );
      setProposal(null);
      onApplied?.(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo aplicar la propuesta");
    } finally {
      setPhase("idle");
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={run} disabled={disabled || phase !== "idle"}>
        {phase === "running" ? "Analizando…" : `✨ ${action.labelEs}`}
      </Button>

      {error && !proposal && (
        <Banner kind="error" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      {proposal && (
        <Card title={`✨ ${action.labelEs}`}>
          <div className="space-y-3">
            <p className="text-sm text-navy">{proposal.summaryEs}</p>
            <ImpactMetrics proposal={proposal} />
            {error && (
              <Banner kind="error" onDismiss={() => setError(null)}>
                {error}
              </Banner>
            )}
            {!proposal.feasible && (
              <Banner kind="info">
                La propuesta no es aplicable con la selección actual.
              </Banner>
            )}
            <div className="flex flex-wrap gap-2">
              {proposal.mutates && (
                <Button onClick={apply} disabled={phase !== "idle" || !proposal.feasible}>
                  {phase === "applying" ? "Aplicando…" : "Aplicar"}
                </Button>
              )}
              <Button variant="secondary" onClick={run} disabled={phase !== "idle"}>
                Ajustar
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setProposal(null);
                  setError(null);
                }}
                disabled={phase !== "idle"}
              >
                Descartar
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
