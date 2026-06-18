MoveOS — Claude Code handoff package

PUT THESE IN THE REPO BEFORE PASTING THE PROMPT (a new Claude Code session reads the repo, not Drive):
- CLAUDE.md                                  -> repo root
- vehicle-type-profiles.ts                   -> packages/shared/src/vehicleTypeProfiles.ts
- Design System & UI/UX Upgrade Spec         -> docs/01_design_system.md
- Vehicle Types: Enum/Migration/Optimizer    -> docs/02_vehicle_types.md
- OptimizationAction Registry Spec           -> docs/03_ai_optimization_registry.md
- Competitive Gap & Adoption Plan            -> docs/04_competitive_complements.md
- Feature Refinement & Hardening Plan        -> docs/05_feature_refinement.md
- Assets: Aileron .woff2 -> public/fonts/ ; Move logo -> assets

=== PASTE THIS PROMPT INTO A NEW CLAUDE CODE SESSION ===

You are working on MoveOS, an EV-only, AI-native last-mile delivery SaaS for
Colombia (TypeScript monorepo: Fastify+Prisma API in apps/api, pure-TS optimizer
in packages/optimizer, shared types in packages/shared, three React frontends —
apps/web dispatcher, apps/admin platform, apps/driver PWA). Significant feature
work is ALREADY built and pushed — do not redo completed work.

STEP 0 — ASSESS FIRST, DO NOT CODE YET:
1. Read CLAUDE.md (non-negotiable constraints: EV-only, B2B-only notifications,
   tenant isolation, Spanish/America-Bogotá, "the LLM only triggers and explains —
   deterministic solvers do the math"). If any task conflicts with it, STOP and flag.
2. Read all specs:
   - docs/01_design_system.md
   - docs/02_vehicle_types.md
   - docs/03_ai_optimization_registry.md
   - docs/04_competitive_complements.md
   - docs/05_feature_refinement.md
   - packages/shared/src/vehicleTypeProfiles.ts  (6 vehicle configs, source of truth)
3. Inspect the current codebase and reply with: (a) what is ALREADY implemented vs
   each spec, (b) what REMAINS, and (c) the plan below restated as PR-sized chunks
   covering ONLY the remaining work. Wait for my approval before writing code.

BUILD ORDER (each phase ships before the next; do NOT jump ahead):
  PHASE A — Design system + restyle (docs/01). VISUAL-ONLY: change typography,
    color, spacing, radius, shadows, and brand microcopy — NO behavior/logic/API
    changes. Sub-steps:
      A1 Foundation: self-host Aileron (@font-face Light/Regular/Medium), set the
         Tailwind theme + CSS tokens (navy #233955, canvas #F3F3F3, lime #CFDD80
         reserved for EV/charging/sustainability, sky #A7B6C4), dark mode on navy.
      A2 Base components: buttons (primary=navy, CTA=lime/navy-text, ghost=outlined),
         inputs (navy focus ring), pill toggles, cards, badges, modals, drawers,
         data table, sidebar (navy + active item lime), header, KPI card, empty-state.
      A3 Restyle EXISTING screens app by app: apps/web, then apps/admin, then
         apps/driver (DARK-FIRST on navy; lime for SoC/charge/success). Replace all
         hardcoded colors with tokens; warm empty states with a brand phrase. Keep
         the logo as an asset.
      A4 Contrast/a11y check (navy-on-canvas + white-on-navy pass; lime is fill only,
         always with navy text; min 12px); build all four frontends.
  PHASE B — Vehicle types (docs/02): verify/finish shared enum + VEHICLE_TYPE_PROFILES,
    additive Prisma migration, optimizer diff (travel factors, capacity + reefer
    feasibility, reefer-on range resolver, pico-y-placa all exempt), Vehiculos.tsx, tests.
  PHASE C — AI optimization layer (docs/03): OptimizationAction registry + /ai/actions
    + shared apply path; wire actions in spec order (existing solvers first); the
    <AiOptimizeButton> component; Copiloto wiring.
  PHASE D — Competitive complements (docs/04): Tier 1 in order — optimization strategy
    selector, configurable POD per type (verify — may be partly done), Services/SLA,
    multi-depot, delivery zones, cost/failure analytics. Then Tier 2.
  PHASE E — Feature hardening (docs/05): remaining cross-cutting items first (global
    typed-error toasts+retry, i18n sweep for admin/portal/Track), then remaining
    Driver/Web/Admin stories. Apply design tokens to every screen touched.

EXECUTION PROTOCOL (every chunk):
- Small, single-purpose PRs/commits — one feature or spec section each.
- Before coding: list the files you'll touch + a 3-5 line plan.
- After coding: add/extend tests, run type-check + tests, confirm CLAUDE.md
  compliance and design-token usage (no hardcoded hex).
- Phase A is visual-only — if a "fix" needs logic, STOP and flag it for a later phase.
- Every list/detail/form has loading, empty, and error states. Validate with shared
  Zod schemas (client+server). No cross-tenant queries. UI copy Spanish, tone
  Claro/Cercano/Profesional; lime reserved for EV/sustainability.
- After each chunk, STOP, summarize what changed + what's next, and wait for my go-ahead.

KNOWN OPEN ITEMS (don't block — leave TODOs):
- IONAX_PICKUP flatbed bed length × width unknown (pack by weight/area, not volume).
- IONAX_COLD_BOX payload may be net or gross of the ~157 kg refrigerated body.
- Soliden font is licensed — fall back to Inter until provided.

Start with STEP 0: read the files, assess the codebase, and give me the done-vs-
remaining summary + restated plan. Do not write code until I approve.
