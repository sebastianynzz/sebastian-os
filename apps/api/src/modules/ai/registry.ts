import type {
  ActionCatalogEntry,
  ActionContext,
  PlanRoutesInput,
  SolveResult,
} from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { todayBogota } from "../../services/dailyMetrics.js";
import { persistPlan, runPlan } from "../../services/planning.js";
import {
  applyResolvedAddresses,
  resolveAddresses,
  type ResolvedAddress,
} from "../../services/aiResolveAddresses.js";

/** Depósito demo (Chapinero). El frontend puede pasar otro vía params.depot. */
const DEFAULT_DEPOT = { lat: 4.6486, lng: -74.0628 };

/**
 * Una acción registrada. `gatherInput` arma la entrada del solver desde el
 * contexto; `solve` corre el solver determinista (sin LLM); `summarize` produce
 * una explicación de respaldo en español; `apply` persiste tras confirmación.
 * El LLM solo entra en `explainProposal` (capa del ejecutor).
 */
export interface RegisteredAction<TInput = unknown, TChange = unknown> {
  meta: ActionCatalogEntry;
  gatherInput(ctx: ActionContext): Promise<TInput>;
  solve(input: TInput, ctx: ActionContext): Promise<SolveResult<TChange>>;
  summarize(result: SolveResult<TChange>): string;
  apply(
    ctx: ActionContext,
    change: TChange,
  ): Promise<{ resultEs: string; data?: unknown }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// optimize_routes — envuelve el VRP existente (planRoutes). Aplica re-resolviendo
// contra el estado actual (no persiste un cambio obsoleto).
// ─────────────────────────────────────────────────────────────────────────────

interface PlanChange {
  routes: {
    vehicleId: string;
    plate?: string;
    totalDistanceKm: number;
    totalDurationMin: number;
    loadKg: number;
    stops: {
      orderId: string;
      kind: "PICKUP" | "DELIVERY";
      sequence: number;
      etaMin: number;
    }[];
  }[];
  unassigned: { orderId: string; reason: string }[];
  excludedVehicles: { vehicleId: string; reason: string }[];
  distanceModel: string | null;
}

function planInputFromCtx(ctx: ActionContext): PlanRoutesInput {
  const depot =
    (ctx.params?.depot as { lat: number; lng: number } | undefined) ??
    DEFAULT_DEPOT;
  const date =
    ctx.date && /^\d{4}-\d{2}-\d{2}$/.test(ctx.date) ? ctx.date : todayBogota();
  return {
    date,
    depot,
    orderIds: ctx.orderIds ?? [],
    vehicleIds: ctx.vehicleIds ?? [],
    socByVehicleId: ctx.params?.socByVehicleId as
      | Record<string, number>
      | undefined,
  };
}

const optimizeRoutes: RegisteredAction<PlanRoutesInput, PlanChange> = {
  meta: {
    id: "optimize_routes",
    labelEs: "Optimizar rutas",
    scope: "PLANNING",
    module: "AI_ADDONS",
    mutates: true,
    roles: ["ADMIN", "DISPATCHER"],
  },
  async gatherInput(ctx) {
    return planInputFromCtx(ctx);
  },
  async solve(input, ctx) {
    const outcome = await runPlan(ctx.tenantId, input);
    if (!outcome.ok) {
      return {
        feasible: false,
        change: {
          routes: [],
          unassigned: [],
          excludedVehicles: [],
          distanceModel: null,
        },
        impact: { feasible: false, notesEs: [outcome.error] },
      };
    }
    const r = outcome.result;
    const distanceKm = r.routes.reduce((a, x) => a + x.totalDistanceKm, 0);
    const change: PlanChange = {
      routes: r.routes.map((x) => ({
        vehicleId: x.vehicleId,
        plate: outcome.dbVehicles.find((v) => v.id === x.vehicleId)?.plate,
        totalDistanceKm: x.totalDistanceKm,
        totalDurationMin: x.totalDurationMin,
        loadKg: x.loadKg,
        stops: x.stops,
      })),
      unassigned: r.unassigned,
      excludedVehicles: r.excludedVehicles,
      distanceModel: outcome.distanceModel,
    };
    return {
      feasible: r.routes.length > 0,
      change,
      impact: {
        feasible: r.routes.length > 0,
        distanceKm: Number(distanceKm.toFixed(2)),
        vehiclesUsed: r.routes.length,
        unassigned: r.unassigned.map((u) => ({
          orderId: u.orderId,
          reasonEs: u.reason,
        })),
        excluded: r.excludedVehicles.map((e) => ({
          vehicleId: e.vehicleId,
          reasonEs: e.reason,
        })),
      },
    };
  },
  summarize(result) {
    const c = result.change;
    const assigned = new Set(c.routes.flatMap((r) => r.stops.map((s) => s.orderId)))
      .size;
    if (!result.feasible) {
      return `No se pudo armar un plan factible. ${
        result.impact.notesEs?.join(" ") ?? ""
      }`.trim();
    }
    const km = result.impact.distanceKm ?? 0;
    const parts = [
      `Plan propuesto: ${c.routes.length} ruta(s) con ${assigned} pedido(s) y ${km} km en total.`,
    ];
    if (c.unassigned.length)
      parts.push(`${c.unassigned.length} pedido(s) sin asignar.`);
    if (c.excludedVehicles.length)
      parts.push(`${c.excludedVehicles.length} vehículo(s) excluido(s).`);
    parts.push("Confirma para crear las rutas.");
    return parts.join(" ");
  },
  async apply(ctx) {
    // Re-resuelve contra el estado actual (evita persistir un plan obsoleto).
    const input = planInputFromCtx(ctx);
    const outcome = await runPlan(ctx.tenantId, input);
    if (!outcome.ok) {
      throw Object.assign(new Error(outcome.error), { statusCode: 409 });
    }
    const created = await persistPlan(
      ctx.tenantId,
      { date: input.date, depot: input.depot },
      outcome.result,
      outcome.dbVehicles,
    );
    return {
      resultEs: `Se crearon ${created.length} ruta(s); ${outcome.result.unassigned.length} pedido(s) quedaron sin asignar.`,
      data: {
        routes: created.length,
        unassigned: outcome.result.unassigned.length,
      },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// resolve_addresses — envuelve la cascada de geocodificación existente.
// Aplica los pines propuestos (lo que el despachador confirmó).
// ─────────────────────────────────────────────────────────────────────────────

interface ResolveInput {
  orderIds?: string[];
}
interface ResolveChange {
  resolved: ResolvedAddress[];
}

const resolveAddressesAction: RegisteredAction<ResolveInput, ResolveChange> = {
  meta: {
    id: "resolve_addresses",
    labelEs: "Resolver direcciones",
    scope: "ADDRESS",
    module: "AI_ADDONS",
    mutates: true,
    roles: ["ADMIN", "DISPATCHER"],
  },
  async gatherInput(ctx) {
    return { orderIds: ctx.orderIds };
  },
  async solve(input, ctx) {
    const { change, impact } = await resolveAddresses(ctx.tenantId, input.orderIds);
    const pct = Math.round(impact.avgConfidence * 100);
    return {
      feasible: impact.resolvable > 0,
      change: { resolved: change },
      impact: {
        feasible: impact.resolvable > 0,
        unassigned: change
          .filter((c) => !c.resolvable)
          .map((c) => ({
            orderId: c.orderId,
            reasonEs: "Requiere corrección manual (baja confianza)",
          })),
        notesEs: [
          `${impact.resolvable}/${impact.total} direcciones resolubles`,
          `Confianza media: ${pct}%`,
          `${impact.needsManual} requieren revisión manual`,
        ],
      },
    };
  },
  summarize(result) {
    const total = result.change.resolved.length;
    const resolvable = result.change.resolved.filter((c) => c.resolvable).length;
    if (total === 0) return "No hay direcciones ambiguas por resolver.";
    return `Direcciones: ${resolvable}/${total} resolubles automáticamente; ${
      total - resolvable
    } requieren revisión manual. Confirma para fijar y aprender los pines.`;
  },
  async apply(ctx, change) {
    const res = await applyResolvedAddresses(ctx.tenantId, change.resolved);
    return {
      resultEs: `${res.applied} dirección(es) resuelta(s) y confirmada(s); ${res.skipped} sin cambios.`,
      data: res,
    };
  },
};

export const AI_ACTION_REGISTRY = {
  optimize_routes: optimizeRoutes,
  resolve_addresses: resolveAddressesAction,
} as Record<string, RegisteredAction>;

/** Catálogo (metadatos) de las acciones registradas. */
export function actionCatalog(): ActionCatalogEntry[] {
  return Object.values(AI_ACTION_REGISTRY).map((a) => a.meta);
}

/** Verifica que el pedido exista en el catálogo y devuelve la acción. */
export function getAction(id: string): RegisteredAction | undefined {
  return AI_ACTION_REGISTRY[id];
}
