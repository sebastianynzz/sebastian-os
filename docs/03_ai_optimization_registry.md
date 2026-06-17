# MoveOS — OptimizationAction Registry Spec

Build spec for the AI optimization layer. One registry powers BOTH the inline "Optimizar con IA" buttons and the Copiloto chat. Deterministic solvers do the math; the LLM (Haiku) only triggers and explains. Confirm-before-apply on every mutation. Respects CLAUDE.md (EV-only; reefer orders → Cold Box configs only).

## 1. Core contracts

  // packages/shared
  export type OptimizationActionId =
    | 'optimize_routes'
    | 'optimize_load'
    | 'pick_vehicle'
    | 'optimize_schedule'
    | 'optimize_charging'      // ⚡ EV
    | 'optimize_cold_chain'    // ❄️ COLD_CHAIN module
    | 'reoptimize_route'
    | 'resolve_addresses'
    | 'plan_capacity';         // advisory (non-mutating)

  export type ActionScope =
    'PLANNING' | 'LOAD' | 'FLEET' | 'SCHEDULE' | 'CHARGING' | 'COLD_CHAIN' | 'EXCEPTION' | 'ADDRESS' | 'CAPACITY';

  // The single shape every action returns. Buttons and chat render the same panel from this.
  export interface Proposal<TChange = unknown> {
    actionId: OptimizationActionId;
    proposalId: string;          // opaque; required to apply
    summaryEs: string;           // LLM-written plain-Spanish explanation
    change: TChange;             // concrete proposed change (routes, assignment, schedule, pins)
    impact: ProposalImpact;      // metrics for the result panel
    mutates: boolean;
    feasible: boolean;
    expiresAt: string;           // ISO; default +5 min
  }

  export interface ProposalImpact {
    feasible: boolean;
    distanceKm?: number;
    distanceDeltaKm?: number;    // vs current
    vehiclesUsed?: number;
    energyKwh?: number;          // ⚡ includes reefer draw where relevant
    costEstimateCop?: number;
    utilizationPct?: number;     // load packing
    timeInBandPct?: number;      // ❄️ cold chain
    unassigned?: { orderId: string; reasonEs: string }[];   // reuse optimizer reasons
    excluded?: { vehicleId: string; reasonEs: string }[];   // reuse optimizer reasons
    notesEs?: string[];
  }

  // Registry entry. Buttons invoke by id+context; Copilot tool-calls map 1:1 to the same ids.
  export interface OptimizationAction<TInput = unknown, TChange = unknown> {
    id: OptimizationActionId;
    labelEs: string;             // button text, e.g. "Optimizar rutas"
    scope: ActionScope;
    module?: 'AI_ADDONS' | 'COLD_CHAIN';   // gating (most require AI_ADDONS)
    mutates: boolean;
    roles: ('ADMIN' | 'DISPATCHER')[];     // who may run/apply
    gatherInput(ctx: ActionContext): Promise<TInput>;       // 1) build solver input from context
    solve(input: TInput): Promise<SolveResult<TChange>>;    // 2) deterministic solve in packages/optimizer, NO LLM
    explain(result: SolveResult<TChange>): Promise<string>; // 3) LLM (Haiku) Spanish narration
    apply(proposalId: string): Promise<ApplyResult>;        // 4) persist — ONLY via /apply after confirm
  }

  export interface ActionContext {
    tenantId: string;
    userId: string;
    role: 'ADMIN' | 'DISPATCHER';
    orderIds?: string[];
    vehicleIds?: string[];
    routeId?: string;
    date?: string;               // Bogotá day
    objective?: 'cost' | 'speed' | 'balanced' | 'coldchain_first';
    params?: Record<string, unknown>;   // tweak/re-run knobs
  }

  export interface SolveResult<TChange> {
    change: TChange;
    impact: ProposalImpact;
    feasible: boolean;
  }

Key invariant: solve() is pure deterministic TypeScript in packages/optimizer. The LLM is used only in explain() (Spanish narration) and, for the chat, to parse a phrase into an ActionContext. Never let the LLM compute change.

## 2. API

  POST /ai/actions/:id/run     (auth: staff, requireModule per action)
    body: ActionContext (without tenantId/userId — taken from token)
    → 200 Proposal           // computed, NOT applied. Read-only actions return advisory Proposal (mutates:false)

  POST /ai/actions/:id/apply   (auth: staff)
    body: { proposalId }
    → 200 ApplyResult         // executes action.apply(); 410 if expired; 409 if state changed

  GET  /ai/actions            (auth: staff)
    → registry catalog the current tenant/role can see (drives which buttons render)

Unification with Copiloto: the chat reuses this exactly. POST /copilot/messages may return a Proposal as its proposedAction; POST /copilot/actions/:id/confirm calls the SAME executor as /ai/actions/:id/apply. One apply path, one audit trail. (The CopilotAction model from the P0 build spec stores the pending proposal.)

Gating & guards: requireModule('AI_ADDONS') on all; requireModule('COLD_CHAIN') additionally on optimize_cold_chain. Actions inherit the caller's role — the AI can never do what the user couldn't. Every apply writes an audit entry.

## 3. The 9 actions

Each: button + example chat phrases → inputs → solver → change/output → impact → mutation.

1. optimize_routes — "Optimizar rutas"
- Trigger: Planificación/Rutas button · chat: "optimiza las rutas de mañana", "replanifica el sur"
- Inputs: orderIds[] (geocoded), vehicleIds[], date, objective.
- Solver: existing planRoutes (VRP → greedy + 2-opt, capacity, time windows, EV range, pico-y-placa exempt).
- Change: proposed Route[] + RouteStop[].
- Impact: distanceKm, vehiclesUsed, energyKwh, unassigned[], excluded[].
- Mutates: yes → persist routes, mark orders ASSIGNED.

2. optimize_load — "Optimizar carga"
- Trigger: Planificación (order set) · chat: "acomoda los paquetes en los vehículos"
- Inputs: orderIds[] (weight/volume), candidate vehicleIds[] with config capacities.
- Solver: bin-packing by kg + m³ against VEHICLE_TYPE_PROFILES; reefer orders only into Cold Box configs; balance utilization.
- Change: order → vehicle assignment map.
- Impact: utilizationPct per vehicle, overflow/unassigned, cold-chain compatibility check.
- Mutates: yes (sets assignment; usually a pre-step to optimize_routes).

3. pick_vehicle — "Elegir vehículo óptimo"
- Trigger: Planificación (fleet mix) · chat: "¿qué vehículo conviene para esta ruta?"
- Inputs: a route or order-cluster (total kg/m³, cold-chain flag, distance).
- Solver: rank the 6 configs by fit — volume/weight headroom, range vs route distance, Cold Box if any reefer order, Pick Up for oversized; Rap Move Light/XL vs IONAx by load.
- Change: recommended config (+ ranked alternatives, each with reasonEs).
- Impact: range margin, utilization, feasibility.
- Mutates: yes (assigns the chosen config), or advisory if just asked.

4. optimize_schedule — "Optimizar turnos y oleadas"
- Trigger: Planificación/Conductores · chat: "arma los turnos y las oleadas de hoy"
- Inputs: known/forecast orderIds by zone, driver roster + availability, shift windows, cutoff times.
- Solver: scheduling — assign drivers to shifts, set AM/PM dispatch waves and cutoffs to match demand.
- Change: shift plan + wave schedule.
- Impact: coverage vs demand, idle/overload flags, drivers used.
- Mutates: yes (writes the schedule).

5. optimize_charging — "⚡ Optimizar carga de batería"
- Trigger: Ev/Planificación · chat: "programa la carga para mañana al menor costo"
- Inputs: vehicles + current SoC, tomorrow's route energy needs (incl. reefer draw for Cold Box), charger availability (depot/public), time-of-use tariff windows.
- Solver: charging scheduler — which vehicle charges when/where to what target SoC, minimizing energy cost and guaranteeing route readiness; never schedule a route a vehicle can't finish.
- Change: per-vehicle charge plan (slot, target SoC, est. cost).
- Impact: costEstimateCop, energyKwh, readiness/feasibility, range-failure risks avoided.
- Mutates: yes (charge schedule).

6. optimize_cold_chain — "❄️ Optimizar cadena de frío"  (module: COLD_CHAIN)
- Trigger: Rutas (reefer) · chat: "ordena las paradas para mantener la cadena de frío"
- Inputs: reefer route stops + each order's tempProfile, current box temp/SoC.
- Solver: sequence stops to minimize time-out-of-band (coldest-sensitive last / by profile), compute pre-cool lead time.
- Change: re-sequenced stops + pre-cool start time.
- Impact: timeInBandPct, projected excursions avoided, distance delta.
- Mutates: yes (route order).

7. reoptimize_route — "Reoptimizar / reasignar"
- Trigger: Excepciones / live route · chat: "la ruta 118 se atrasó, reasigna lo pendiente"
- Inputs: live routeId + event (late/failed/breakdown), current SoC, nearby vehicles.
- Solver: existing express insertion / rebalance — freeze attended stops, re-optimize the pending queue (incl. EV SoC), 422 if infeasible.
- Change: revised route(s) / reassignment.
- Impact: distanceDeltaKm, stops moved, feasibility.
- Mutates: yes.

8. resolve_addresses — "Resolver direcciones"
- Trigger: Direcciones (triage) · chat: "resuelve las direcciones ambiguas"
- Inputs: ambiguous/unresolved orderIds[].
- Solver: existing resolver cascade (learned graph → Lupap/Google) → best-guess pin + candidates per order.
- Change: per-order proposed pin.
- Impact: count resolvable, avg confidence, count needing manual.
- Mutates: yes (on apply → learnAddressPin + AddressCorrection).

9. plan_capacity — "Planear capacidad"  (advisory, non-mutating)
- Trigger: Analítica/Admin planning · chat: "¿cuántos vehículos necesito el lunes?"
- Inputs: demand forecast by zone/day (from history), current fleet by config.
- Solver: capacity model → recommended count of each of the 6 configs + drivers to deploy.
- Change: advisory deployment plan.
- Impact: projected coverage, gaps/surplus by config.
- Mutates: no (advisory only; returns mutates:false, no apply).

## 4. Frontend contract

One reusable component, used across apps/web (and admin planning views):

  <AiOptimizeButton
    actionId="optimize_routes"
    context={{ orderIds, vehicleIds, date }}   // from current screen selection
    onApplied={(result) => reload()}
  />

Behavior: button (✨ {action.labelEs}) → POST /ai/actions/:id/run → render the shared result panel from Proposal (summaryEs + impact metrics + unassigned/excluded) → Aplicar (/apply) · Ajustar (edit context.params, re-run) · Descartar. Only render buttons returned by GET /ai/actions for the tenant/role. Mutating actions apply only on Aplicar.

## 5. Build order & acceptance

1. Registry + contracts (packages/shared) and the /ai/actions endpoints + executor (shared with Copiloto confirm).
2. Wrap existing capability first — optimize_routes, reoptimize_route, resolve_addresses: these already have solvers; just register + add the button/panel. Fastest visible win.
3. New solvers — optimize_load, pick_vehicle — depend on VEHICLE_TYPE_PROFILES (the 6 configs), so land after the vehicle specs are in.
4. EV/cold-chain — optimize_charging, optimize_cold_chain.
5. Scheduling & capacity — optimize_schedule, plan_capacity.
6. Copiloto — map chat intents to the same registry ids; reuse the apply/confirm path.

Definition of done (per action): deterministic solve() with unit tests; explain() produces clear Spanish; /run returns a Proposal with real impact metrics; /apply is idempotent, audited, and confirm-gated; the button renders only when the module+role allow; reefer orders never routed to a non-Cold-Box config.
