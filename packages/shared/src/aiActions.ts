import { z } from "zod";

/**
 * Contratos de la capa de optimización con IA. Un solo registro alimenta tanto
 * los botones "Optimizar con IA" como el Copiloto. Los solvers deterministas
 * hacen la matemática; el LLM (Haiku) solo dispara y explica. Confirmación
 * antes de aplicar en toda mutación. (CLAUDE.md: EV-only; pedidos reefer → solo
 * Cold Box compatible.)
 */

export const OPTIMIZATION_ACTION_IDS = [
  "optimize_routes",
  "optimize_load",
  "pick_vehicle",
  "optimize_schedule",
  "optimize_charging", // ⚡ EV
  "optimize_cold_chain", // ❄️ COLD_CHAIN
  "reoptimize_route",
  "resolve_addresses",
  "plan_capacity", // asesor (no muta)
] as const;
export type OptimizationActionId = (typeof OPTIMIZATION_ACTION_IDS)[number];

export const ACTION_SCOPES = [
  "PLANNING",
  "LOAD",
  "FLEET",
  "SCHEDULE",
  "CHARGING",
  "COLD_CHAIN",
  "EXCEPTION",
  "ADDRESS",
  "CAPACITY",
] as const;
export type ActionScope = (typeof ACTION_SCOPES)[number];

/** Roles del personal que pueden ejecutar/aplicar una acción. */
export type ActionRole = "ADMIN" | "DISPATCHER";

/** Métricas para el panel de resultado. Reutiliza las razones del optimizador. */
export interface ProposalImpact {
  feasible: boolean;
  distanceKm?: number;
  distanceDeltaKm?: number; // vs actual
  vehiclesUsed?: number;
  energyKwh?: number; // ⚡ incluye consumo del reefer donde aplica
  costEstimateCop?: number;
  utilizationPct?: number; // empaque de carga
  timeInBandPct?: number; // ❄️ cadena de frío
  unassigned?: { orderId: string; reasonEs: string }[];
  excluded?: { vehicleId: string; reasonEs: string }[];
  notesEs?: string[];
}

/** La forma única que devuelve toda acción. Botones y chat renderizan igual. */
export interface Proposal<TChange = unknown> {
  actionId: OptimizationActionId;
  proposalId: string; // opaco; requerido para aplicar
  summaryEs: string; // explicación en español (LLM o plantilla)
  change: TChange; // cambio concreto propuesto (rutas, asignación, pines)
  impact: ProposalImpact;
  mutates: boolean;
  feasible: boolean;
  expiresAt: string; // ISO; por defecto +5 min
}

/** Contexto de invocación. El tenant/usuario/rol vienen del token, no del body. */
export interface ActionContext {
  tenantId: string;
  userId: string;
  role: ActionRole;
  orderIds?: string[];
  vehicleIds?: string[];
  routeId?: string;
  date?: string; // día Bogotá
  objective?: "cost" | "speed" | "balanced" | "coldchain_first";
  params?: Record<string, unknown>; // perillas de re-ejecución/ajuste
}

export interface SolveResult<TChange = unknown> {
  change: TChange;
  impact: ProposalImpact;
  feasible: boolean;
}

/** Resultado de aplicar (persistir) una propuesta tras la confirmación. */
export interface ApplyResult {
  ok: boolean;
  proposalId: string;
  actionId: OptimizationActionId;
  summaryEs: string;
  appliedAt: string; // ISO
  resultEs?: string;
  data?: unknown;
}

/** Metadatos de catálogo que el GET /ai/actions expone para pintar botones. */
export interface ActionCatalogEntry {
  id: OptimizationActionId;
  labelEs: string;
  scope: ActionScope;
  module?: "AI_ADDONS" | "COLD_CHAIN";
  mutates: boolean;
  roles: ActionRole[];
}

/**
 * Cuerpo de POST /ai/actions/:id/run (sin tenantId/userId/role: salen del
 * token). Validador compartido cliente + servidor.
 */
export const aiActionRunSchema = z.object({
  orderIds: z.array(z.string()).optional(),
  vehicleIds: z.array(z.string()).optional(),
  routeId: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  objective: z.enum(["cost", "speed", "balanced", "coldchain_first"]).optional(),
  params: z.record(z.unknown()).optional(),
});
export type AiActionRunInput = z.infer<typeof aiActionRunSchema>;

/** Cuerpo de POST /ai/actions/:id/apply. */
export const aiActionApplySchema = z.object({
  proposalId: z.string().min(1),
});
export type AiActionApplyInput = z.infer<typeof aiActionApplySchema>;

export const DEFAULT_PROPOSAL_TTL_MS = 5 * 60 * 1000;
