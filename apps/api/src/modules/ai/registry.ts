import {
  VEHICLE_EMISSIONS,
  VEHICLE_TYPE_PROFILES,
  type ActionCatalogEntry,
  type ActionContext,
  type PlanRoutesInput,
  type SolveResult,
  type TempProfile,
  type VehicleType,
} from "@moveos/shared";
import {
  packLoad,
  planCharging,
  rankVehicleConfigs,
  reeferEnergyKwh,
  sequenceColdChain,
  type ChargeVehicleInput,
  type ColdStopInput,
  type PackOrder,
  type PackVehicle,
  type PickRequest,
} from "@moveos/optimizer";
import { prisma } from "../../lib/prisma.js";
import { todayBogota } from "../../services/dailyMetrics.js";
import { persistPlan, runPlan } from "../../services/planning.js";
import { computeInsertion, persistInsertion } from "../../services/insertion.js";
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

// ─────────────────────────────────────────────────────────────────────────────
// reoptimize_route — envuelve la inserción exprés existente (computeInsertion).
// Reasigna/insiere un pedido pendiente en una ruta en curso; aplica
// re-calculando contra el estado actual.
// ─────────────────────────────────────────────────────────────────────────────

interface ReoptInput {
  routeId: string;
  orderId: string;
}
interface ReoptChange {
  routeId: string;
  orderId: string;
  insertedAt: number;
  totalDistanceKm: number;
  error?: string;
}

const reoptimizeRoute: RegisteredAction<ReoptInput, ReoptChange> = {
  meta: {
    id: "reoptimize_route",
    labelEs: "Reoptimizar / reasignar",
    scope: "EXCEPTION",
    module: "AI_ADDONS",
    mutates: true,
    roles: ["ADMIN", "DISPATCHER"],
  },
  async gatherInput(ctx) {
    return {
      routeId: ctx.routeId ?? "",
      orderId: (ctx.params?.orderId as string) ?? ctx.orderIds?.[0] ?? "",
    };
  },
  async solve(input, ctx) {
    if (!input.routeId || !input.orderId) {
      return {
        feasible: false,
        change: { routeId: input.routeId, orderId: input.orderId, insertedAt: -1, totalDistanceKm: 0 },
        impact: { feasible: false, notesEs: ["Faltan routeId u orderId"] },
      };
    }
    const computed = await computeInsertion(ctx.tenantId, input.routeId, input.orderId);
    if (!computed.ok) {
      return {
        feasible: false,
        change: {
          routeId: input.routeId,
          orderId: input.orderId,
          insertedAt: -1,
          totalDistanceKm: 0,
          error: computed.error,
        },
        impact: { feasible: false, notesEs: [computed.error] },
      };
    }
    return {
      feasible: true,
      change: {
        routeId: input.routeId,
        orderId: input.orderId,
        insertedAt: computed.result.insertedAt,
        totalDistanceKm: computed.result.totalDistanceKm,
      },
      impact: {
        feasible: true,
        distanceKm: computed.result.totalDistanceKm,
        notesEs: [
          `Inserción en la posición ${computed.result.insertedAt + 1} de la cola pendiente`,
        ],
      },
    };
  },
  summarize(result) {
    if (!result.feasible) {
      return `No se pudo reoptimizar: ${result.change.error ?? result.impact.notesEs?.join(" ") ?? ""}`.trim();
    }
    return `Se insertaría el pedido en la posición ${
      result.change.insertedAt + 1
    } (cola pendiente, ${result.change.totalDistanceKm} km). Confirma para reasignar.`;
  },
  async apply(ctx, change) {
    const computed = await computeInsertion(ctx.tenantId, change.routeId, change.orderId);
    if (!computed.ok) {
      throw Object.assign(new Error(computed.error), {
        statusCode: computed.statusCode === 422 ? 422 : 409,
      });
    }
    await persistInsertion(
      ctx.tenantId,
      computed.route,
      computed.newOrder,
      computed.attendedCount,
      computed.result,
    );
    return {
      resultEs: `Pedido reasignado en la ruta (posición ${computed.result.insertedAt + 1}).`,
      data: { insertedAt: computed.result.insertedAt },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// optimize_load — empaque de carga (advisory). Propone una asignación
// pedido→vehículo por capacidad + cadena de frío. No persiste todavía:
// persistir la asignación es decisión de producto (campo en Order o fusión con
// optimize_routes); por ahora alimenta la decisión del despachador.
// ─────────────────────────────────────────────────────────────────────────────

const optimizeLoad: RegisteredAction<
  { orders: PackOrder[]; vehicles: PackVehicle[] },
  ReturnType<typeof packLoad>
> = {
  meta: {
    id: "optimize_load",
    labelEs: "Optimizar carga",
    scope: "LOAD",
    module: "AI_ADDONS",
    mutates: false,
    roles: ["ADMIN", "DISPATCHER"],
  },
  async gatherInput(ctx) {
    const [orders, vehicles] = await Promise.all([
      prisma.order.findMany({
        where: { id: { in: ctx.orderIds ?? [] }, tenantId: ctx.tenantId },
        select: { id: true, weightKg: true, volumeM3: true, tempProfile: true },
      }),
      prisma.vehicle.findMany({
        where: { id: { in: ctx.vehicleIds ?? [] }, tenantId: ctx.tenantId },
        select: { id: true, type: true },
      }),
    ]);
    return {
      orders: orders.map((o) => ({
        id: o.id,
        weightKg: o.weightKg,
        volumeM3: o.volumeM3 ?? undefined,
        tempProfile: o.tempProfile as PackOrder["tempProfile"],
      })),
      vehicles: vehicles.map((v) => ({
        id: v.id,
        type: v.type as PackVehicle["type"],
      })),
    };
  },
  async solve(input) {
    const result = packLoad(input.orders, input.vehicles);
    const totalAssigned = result.assignments.reduce(
      (a, x) => a + x.orderIds.length,
      0,
    );
    const avgUtil = result.assignments.length
      ? Math.round(
          result.assignments.reduce((a, x) => a + x.utilizationPct, 0) /
            result.assignments.length,
        )
      : 0;
    return {
      feasible: totalAssigned > 0,
      change: result,
      impact: {
        feasible: totalAssigned > 0,
        vehiclesUsed: result.assignments.length,
        utilizationPct: avgUtil,
        unassigned: result.unassigned.map((u) => ({
          orderId: u.orderId,
          reasonEs: u.reason,
        })),
        notesEs: [
          `${totalAssigned} pedido(s) empacados en ${result.assignments.length} vehículo(s)`,
        ],
      },
    };
  },
  summarize(result) {
    const a = result.change.assignments;
    const assigned = a.reduce((acc, x) => acc + x.orderIds.length, 0);
    return `Empaque propuesto: ${assigned} pedido(s) en ${a.length} vehículo(s); ${result.change.unassigned.length} sin acomodar. Recomendación para planificar.`;
  },
  async apply() {
    // Advisory: no muta (el ejecutor ya rechaza apply con 400 ADVISORY_ONLY).
    return { resultEs: "Acción asesora: no persiste cambios." };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// pick_vehicle — ranking de configuraciones (advisory). Recomienda el vehículo
// óptimo para un clúster (kg/m³, cadena de frío, distancia, sobredimensión).
// ─────────────────────────────────────────────────────────────────────────────

const pickVehicle: RegisteredAction<
  PickRequest,
  { ranked: ReturnType<typeof rankVehicleConfigs> }
> = {
  meta: {
    id: "pick_vehicle",
    labelEs: "Elegir vehículo óptimo",
    scope: "FLEET",
    module: "AI_ADDONS",
    mutates: false,
    roles: ["ADMIN", "DISPATCHER"],
  },
  async gatherInput(ctx) {
    // Desde params explícitos, o agregando los pedidos seleccionados.
    if (ctx.orderIds && ctx.orderIds.length) {
      const orders = await prisma.order.findMany({
        where: { id: { in: ctx.orderIds }, tenantId: ctx.tenantId },
        select: { weightKg: true, volumeM3: true, tempProfile: true },
      });
      const totalKg = orders.reduce((a, o) => a + o.weightKg, 0);
      const totalM3 = orders.reduce((a, o) => a + (o.volumeM3 ?? 0), 0);
      const coldChain = orders.some((o) => o.tempProfile === "FROZEN")
        ? "FROZEN"
        : orders.some((o) => o.tempProfile === "CHILLED")
          ? "CHILLED"
          : "AMBIENT";
      return {
        totalKg,
        totalM3,
        coldChain,
        distanceKm: ctx.params?.distanceKm as number | undefined,
        oversized: ctx.params?.oversized as boolean | undefined,
      };
    }
    const p = ctx.params ?? {};
    return {
      totalKg: Number(p.totalKg ?? 0),
      totalM3: p.totalM3 as number | undefined,
      coldChain: p.coldChain as PickRequest["coldChain"],
      distanceKm: p.distanceKm as number | undefined,
      oversized: p.oversized as boolean | undefined,
    };
  },
  async solve(input) {
    const ranked = rankVehicleConfigs(input);
    const top = ranked[0];
    return {
      feasible: !!top?.feasible,
      change: { ranked },
      impact: {
        feasible: !!top?.feasible,
        utilizationPct: top?.utilizationPct,
        notesEs: top
          ? [`Recomendado: ${top.labelEs} — ${top.reasonEs}`]
          : ["Sin configuración apta"],
      },
    };
  },
  summarize(result) {
    const top = result.change.ranked[0];
    if (!top || !top.feasible) return "Ninguna configuración cumple los requisitos.";
    return `Vehículo recomendado: ${top.labelEs} (${top.reasonEs}).`;
  },
  async apply() {
    return { resultEs: "Acción asesora: no persiste cambios." };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// optimize_charging (⚡ EV, advisory) — programa la recarga al menor costo según
// la energía de la ruta del día siguiente (incl. reefer) y la tarifa horaria.
// Advisory: no hay modelo de plan de carga que consumir; recomienda y explica.
// ─────────────────────────────────────────────────────────────────────────────

const optimizeCharging: RegisteredAction<
  ChargeVehicleInput[],
  ReturnType<typeof planCharging>
> = {
  meta: {
    id: "optimize_charging",
    labelEs: "⚡ Optimizar carga de batería",
    scope: "CHARGING",
    module: "AI_ADDONS",
    mutates: false,
    roles: ["ADMIN", "DISPATCHER"],
  },
  async gatherInput(ctx) {
    const vehicles = await prisma.vehicle.findMany({
      where: {
        tenantId: ctx.tenantId,
        isElectric: true,
        ...(ctx.vehicleIds?.length ? { id: { in: ctx.vehicleIds } } : {}),
      },
      select: { id: true, type: true, batteryKwh: true, socPercent: true },
    });
    const date = ctx.date && /^\d{4}-\d{2}-\d{2}$/.test(ctx.date) ? ctx.date : todayBogota();
    const routes = await prisma.route.findMany({
      where: { tenantId: ctx.tenantId, date },
      select: { vehicleId: true, totalDistanceKm: true, totalDurationMin: true },
    });
    const byVehicle = new Map<string, { distKm: number; durMin: number }>();
    for (const r of routes) {
      const e = byVehicle.get(r.vehicleId) ?? { distKm: 0, durMin: 0 };
      e.distKm += r.totalDistanceKm;
      e.durMin += r.totalDurationMin;
      byVehicle.set(r.vehicleId, e);
    }
    return vehicles.map((v) => {
      const type = v.type as VehicleType;
      const profile = VEHICLE_TYPE_PROFILES[type];
      const batteryKwh = v.batteryKwh ?? profile.batteryOptions[0]!.batteryKwh;
      const agg = byVehicle.get(v.id) ?? { distKm: 0, durMin: 0 };
      const evKwhPerKm = VEHICLE_EMISSIONS[type].evKwhPerKm;
      const reefer = profile.reefer ? reeferEnergyKwh(type, agg.durMin / 60) : 0;
      return {
        id: v.id,
        type,
        batteryKwh,
        socPercent: v.socPercent ?? 100,
        energyNeedKwh: Number((agg.distKm * evKwhPerKm + reefer).toFixed(2)),
      };
    });
  },
  async solve(input) {
    const result = planCharging(input);
    return {
      feasible: result.atRisk.length === 0,
      change: result,
      impact: {
        feasible: result.atRisk.length === 0,
        energyKwh: result.totalEnergyKwh,
        costEstimateCop: result.totalCostCop,
        notesEs: [
          `${result.plans.length} vehículo(s); ${result.totalEnergyKwh} kWh a recargar`,
          ...(result.atRisk.length
            ? [`${result.atRisk.length} vehículo(s) con ruta que excede su batería`]
            : []),
        ],
      },
    };
  },
  summarize(result) {
    const r = result.change;
    return `Plan de carga: ${r.totalEnergyKwh} kWh por ~$${r.totalCostCop.toLocaleString(
      "es-CO",
    )} en valle nocturno${r.atRisk.length ? `; ${r.atRisk.length} en riesgo de autonomía` : ""}.`;
  },
  async apply() {
    return { resultEs: "Acción asesora: no persiste cambios." };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// optimize_cold_chain (❄️ COLD_CHAIN, advisory) — recomienda el orden de entrega
// de una ruta reefer priorizando lo más sensible y el pre-enfriamiento.
// Advisory: re-secuenciar persistiendo requiere un objetivo geográfico
// consciente de frío (refinamiento futuro). Por ahora recomienda y explica.
// ─────────────────────────────────────────────────────────────────────────────

const optimizeColdChain: RegisteredAction<
  { stops: ColdStopInput[] },
  ReturnType<typeof sequenceColdChain>
> = {
  meta: {
    id: "optimize_cold_chain",
    labelEs: "❄️ Optimizar cadena de frío",
    scope: "COLD_CHAIN",
    module: "COLD_CHAIN",
    mutates: false,
    roles: ["ADMIN", "DISPATCHER"],
  },
  async gatherInput(ctx) {
    const route = await prisma.route.findFirst({
      where: { id: ctx.routeId ?? "", tenantId: ctx.tenantId },
      include: {
        stops: {
          where: { kind: "DELIVERY" },
          orderBy: { sequence: "asc" },
          include: { order: { select: { tempProfile: true } } },
        },
      },
    });
    if (!route) return { stops: [] };
    return {
      stops: route.stops.map((s) => ({
        orderId: s.orderId,
        tempProfile: s.order.tempProfile as TempProfile,
        etaMin: s.etaMin,
      })),
    };
  },
  async solve(input) {
    const result = sequenceColdChain(input.stops);
    return {
      feasible: input.stops.length > 0,
      change: result,
      impact: {
        feasible: input.stops.length > 0,
        timeInBandPct: result.timeInBandPct,
        notesEs: result.notesEs,
      },
    };
  },
  summarize(result) {
    const r = result.change;
    if (r.sensitiveCount === 0) return "Ruta sin pedidos sensibles a temperatura.";
    return `Cadena de frío: ${r.sensitiveCount} entrega(s) sensible(s) al inicio, pre-enfriar ${r.preCoolLeadMin} min; ${r.movedCount} parada(s) reordenada(s).`;
  },
  async apply() {
    return { resultEs: "Acción asesora: no persiste cambios." };
  },
};

export const AI_ACTION_REGISTRY = {
  optimize_routes: optimizeRoutes,
  optimize_load: optimizeLoad,
  pick_vehicle: pickVehicle,
  optimize_charging: optimizeCharging,
  optimize_cold_chain: optimizeColdChain,
  reoptimize_route: reoptimizeRoute,
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
