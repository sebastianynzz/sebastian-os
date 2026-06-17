# MoveOS — Session Handoff

Branch: `claude/pensive-hypatia-otcrfu` (pushed through `0dd3e15`; descends from
`claude/relaxed-ramanujan-jqykyw` @ `3ab7570`, same tree).
Resume work at **Phase D4 multi-depot** (see "What's left").

To resume:

```bash
cd /home/user/move-os && git checkout claude/pensive-hypatia-otcrfu && git pull && claude
```

The 6 design/feature specs live in the repo at `docs/00_START_HERE.md` … `docs/05_feature_refinement.md`
(uploads do NOT carry across sessions — read them from the repo).

---

## Kickoff prompt (paste as the first message of a fresh session)

> Continue the MoveOS go-live build on branch `claude/relaxed-ramanujan-jqykyw`
> (already checked out, pushed through `925071d`). Read `CLAUDE.md` and the
> specs in `docs/00_START_HERE.md` … `docs/05_feature_refinement.md`, then read
> the ledger below. Respect the hard constraints: EV-only, **B2B-only (no
> direct-to-consumer messaging)**, **no payments/COD**, tenant isolation,
> Spanish + America/Bogotá, "deterministic solvers do the math; the LLM only
> triggers and explains; confirm-before-mutate."
>
> Phases A, B, C are DONE; Phase D Tier-1 is in progress (D1, D2, D3a done).
> **Start at D3b.** Before coding each chunk: list the files you'll touch + a
> 3–5 line plan. After coding: add/extend tests, run the build + test gates,
> confirm CLAUDE.md compliance and design-token usage (no hardcoded hex), then
> commit + push and STOP to summarize. One feature per commit. Keep additive
> Prisma migrations (`migrate deploy`-safe). Do not reintroduce COD.

---

## DONE this session (committed + pushed, builds green)

**Phase A — Design system (complete), per `docs/01`:**
- A1 token foundation to Manual de Identidad v2.0 (navy #233955, canvas #F3F3F3,
  lime #CFDD80, sky #A7B6C4 + semantic/radius/shadow tokens) across web/admin/driver
  (`fb3806f`); self-hosted **Aileron** (6 WOFF2, weights 300/400/600 + italics)
  with active `@font-face` (`52930ad`).
- A2 base components (`a9084f0`): Button (primary=navy, `cta`=lime, ghost),
  navy-focus inputs, token Badges/Banner, `KpiCard`, `PillToggle`, `Modal`,
  `Drawer`, warm `EmptyState`.
- A3 restyle: web (`9a8d7b6`), admin dark theme (`0671993`), driver tokenize
  (`432fdb2`) + **user-switchable dark/light theme, dark-first** (`102d702`).
- Logo (`925071d`): `move-{lime,navy,white}.svg` in each app's `public/`, wired
  into both shells, both logins, driver header. **Generated from Aileron
  outlines** because the official file never transferred (only arrived as chat
  images) — swap `apps/*/public/move-*.svg` with the official asset anytime.

**Phase D — competitive Tier 1 (`docs/04`):**
- **D1 strategy selector** (`ef1a728`): `OPTIMIZATION_OBJECTIVES` (5, default
  BALANCE) in `@moveos/shared`; `planRoutes()` assignment policy per objective
  (`assignmentScore`); threaded API `runPlan`→`solveVrp`; Planificación `<select>`.
  77 optimizer tests pass (incl. new objective test).
- **D2 configurable POD per type** (`4766b43` backend, `64e1464` frontend):
  `DELIVERY_TYPES/PICKUP_TYPES/POD_REQ`, `podPolicyConfigSchema`,
  `resolvePodReq()`; `PodPolicy` model + `ProofOfDelivery.deliveryType` (migration
  `20260618000000_pod_policy_by_type`); `/controls/pod-policy` (GET/PATCH, ADMIN);
  enforcement in `/routes/stops/:id/complete` (per-type + per-client); Controles ›
  "Prueba de entrega" page; driver deliver-sheet type picker.
  **NO COD** (deliberate deviation from Spoke — MoveOS takes no payments).
  Tests: `controlsPodPolicy.test.ts` (3) + `podPolicy`/`podEvidence` (8) green.
- **D3a Services/SLA foundation** (`fd9d44c`): `SERVICE_STOP_TYPES`, `WEEKDAYS`,
  `serviceSchema`, `slaDueAt()`/`isSlaBreached()`; `Service` model + nullable
  `Order.serviceId` FK (migration `20260618010000_services_sla`); `/services`
  CRUD module (GET any-staff; POST/PATCH/DELETE ADMIN; 409 on dup identifier);
  `createOrder` persists `serviceId`. Smoke-verified; **no e2e test yet** (D3b).
- **D3b Services/SLA finish** (`b38db8b`…`0dd3e15`, 5 commits):
  (1) `SLA_BREACH` in the Exceptions Cockpit — in-flight orders with a service
  raise HIGH (breached) / MEDIUM (≤30 min, por vencer) via `slaDueAt`, OPEN_ROUTE
  when on a route (+ `slaDueAt` unit test). (2) `GET /analytics/sla-report`
  (gated ANALYTICS_PRO) + per-client SLA table on Analítica. (3) **Controles ›
  Servicios** CRUD page (ADMIN nav) over the D3a module; shared
  `WEEKDAY_LABELS`/`SERVICE_STOP_TYPE_LABELS`. (4) `serviceId` wired onto orders:
  validated in `createOrder` (tenant-scoped), in the orders list, Pedidos column
  + filter + form, portal schema + `GET /portal/services` + portal selector.
  (5) `services.test.ts` e2e (9). Full API suite green: 34 files / 199 tests.

(Phases B vehicle types + C AI optimization were completed by prior sessions.)

## What's left

**D4 multi-depot · D5 delivery zones · D6 cost/failure analytics** (energy-native
cost = routeHours×driverCostPerHour + kWh×tariff), then **Tier 2** (notification
engine B2B-only, developer platform, custom stop props, driver permissions, barcode).

**Carry-over polish:**
- `--text-tertiary #8a99a8` on white is ~2.9:1 (fails AA for body text) — darken
  in the Phase E a11y pass (it's the spec-defined caption color; left as-spec).
- **Aileron Medium (500)** not provided — weight 500 currently falls back to
  Regular 400 (no faux-bold). Drop `apps/*/public/fonts/aileron-medium.woff2` +
  add a 500 `@font-face` when available.
- Official **logo** file (see above) to replace the font-derived SVGs.

## Environment notes

- **Postgres stops between turns / on container restart.** Bring it up:
  ```bash
  export PATH=/usr/lib/postgresql/16/bin:$PATH
  pg_isready -h localhost -p 5432 || su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/moveos-pg -l /tmp/pg.log start"
  export DATABASE_URL="postgresql://moveos:moveos@localhost:5432/moveos"
  ```
  First-time setup, demo logins, and the headless-Chromium driver are documented
  in the `run-move-os` skill (`.claude/skills/run-move-os/SKILL.md`). After schema
  changes: `pnpm --filter @moveos/api exec prisma generate` then `db:migrate:deploy`.
- **Start the API as a managed background task** (not a detached `nohup &`) — a
  detached `tsx src/server.ts` from a prior turn can survive and hold port 3000,
  serving a STALE build (symptom: new routes 404 while old ones 200). If that
  happens, `pkill -9 -f "src/server.ts"` then restart.
- **Gates:** `pnpm -r build` (6 packages, strict tsc + vite);
  `pnpm --filter @moveos/optimizer test` (77); API e2e need Postgres:
  `pnpm --filter @moveos/api exec vitest run src/tests/<file>`.
- **Screenshots:** `node .claude/skills/run-move-os/driver.mjs shot <url> <out.png> [email] [pwd]`
  (npm-bundled Chromium; the chrome-devtools MCP can't find a system Chrome here).
  Use `waitUntil:"domcontentloaded"` for authed pages (SSE keeps the socket open,
  so `networkidle` times out). To render an SVG/HTML to PNG, point a tiny
  playwright-core script at a `file://` and run it FROM the skill dir (so
  `node_modules` resolves).
- **GateGuard** fact-gates the first write/edit per file (and the first Bash) —
  state importers/affected API/data/instruction, then retry the identical call.
  Quiet it with `ECC_GATEGUARD=off` or `ECC_DISABLED_HOOKS=pre:edit-write:gateguard-fact-force`.
- The logo SVGs were generated with `fontTools` (`SVGPathPen` over the Aileron
  glyph outlines) — see the chat history if you need to regenerate.

## Protocol

One feature per commit; before coding name the files + a 3–5 line plan; after
coding add/extend tests, run build + tests, confirm CLAUDE.md compliance + design
tokens (no hardcoded hex), then commit/push and STOP to summarize. Solvers are
deterministic; the LLM only triggers and explains; confirm-before-mutate on every
mutation. Commit-message trailers:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` and the `Claude-Session:` link.
