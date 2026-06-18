# MoveOS — Session Handoff

Branch: `claude/charming-ritchie-d51s46` (pushed through `6d46c9f`; the prior
`claude/pensive-hypatia-otcrfu` name in older notes is stale — this branch
carries the same ledger and continues from `e4e687c`).
**Tier-1 (D1–D6) COMPLETE; Tier-2 §7 (notifications) + §8 (developer platform
core) + §9 (custom stop properties) + §10 (driver permissions layer) COMPLETE.**
Resume at **Tier-2 §11 (barcode scanning at load-out + delivery)**; see "What's
left". §8 connectors + fast-follows noted there.

To resume:

```bash
cd /home/user/move-os && git checkout claude/charming-ritchie-d51s46 && git pull && claude
```

The 6 design/feature specs live in the repo at `docs/00_START_HERE.md` … `docs/05_feature_refinement.md`
(uploads do NOT carry across sessions — read them from the repo).

---

## Kickoff prompt (paste as the first message of a fresh session)

> Continue the MoveOS go-live build on branch `claude/charming-ritchie-d51s46`
> (already checked out, pushed through `6d46c9f`). First read, in order:
> `CLAUDE.md`, `HANDOFF.md` (this file — esp. "What's left", "Environment notes",
> "Protocol"), and the specs `docs/00_START_HERE.md` … `docs/05_feature_refinement.md`
> (uploads don't carry across sessions — read them from the repo).
>
> Respect the hard constraints: **EV-only**; **B2B-only** (never message the end
> consumer — notify the merchant + the public tracking page); **no payments/COD**;
> tenant isolation (`verifyTenantToken` / every query scoped by `tenantId`);
> Spanish + America/Bogotá; deterministic solvers do the math, the LLM only
> triggers and explains, confirm-before-mutate on every mutation; design tokens
> only (no hardcoded hex).
>
> State of play: Phases A/B/C done; **Phase D Tier-1 (D1–D6) COMPLETE**; **Tier-2
> §7 (notification engine: tracking-privacy tiers + per-event B2B templates),
> §8 (developer platform core: signed webhooks + API keys + order ingestion + UI),
> §9 (custom stop properties), and §10 (driver permissions layer) COMPLETE.**
> Full API suite green (45 files / 260 tests).
>
> **START AT Tier-2 §11 — barcode scanning at load-out + delivery** (docs/04 §11):
> `ScanEvent { tenantId; orderId; type (LOAD|DELIVER|PICKUP); barcode; scannedAt }`
> — the driver app already scans at pickup/delivery (`/routes/stops/:id/scan`
> emits SCANNED/SCAN_MISMATCH order events); §11 adds the LOAD (load-out manifest
> verification at the depot) use plus a persisted ScanEvent chain-of-custody and a
> loading manifest on Rutas. Then §8 connectors / Tier 3 / Phase E hardening (see
> "What's left").
>
> Working agreement (per chunk): bring Postgres up first (commands under
> "Environment notes"); before coding list the files you'll touch + a 3–5 line
> plan; after coding add/extend tests, run `pnpm -r build`,
> `pnpm --filter @moveos/optimizer test`, and the relevant API e2e (needs
> Postgres); confirm CLAUDE.md compliance + design tokens; keep Prisma migrations
> additive (`migrate deploy`-safe); one feature per commit; then commit + push to
> `claude/charming-ritchie-d51s46` and STOP to summarize. Do not reintroduce COD.
> (GateGuard fact-gates the first edit per file — state importers/affected
> API/data/instruction then retry; or `ECC_GATEGUARD=off` to silence it.)

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
- **D4 multi-depot core** (`3f5ab84`…`df193be`, 3 commits):
  (1) `Depot` model + additive migration `20260619000000_multi_depot` (nullable
  `Route.depotId`, `Driver.depotId`, `Vehicle.homeDepotId`, ON DELETE SET NULL) +
  `/depots` CRUD (ADMIN mutate) keeping a single `isMain` per tenant + shared
  `depotSchema` + e2e. (2) **Controles › Depósitos** CRUD page (ADMIN nav).
  (3) `planRoutesSchema.depotId` → `runPlan` resolves the depot tenant-scoped, its
  coords drive the optimizer depart/return point and `Route.depotId` is linked
  (manual + AI `optimize_routes`); Planificación depot selector. Full API suite
  green: 35 files / 207 tests.
- **D5 delivery zones core** (`9651bea`…`071e0ee`, 3 commits):
  (1) `Zone` model + additive migration `20260620000000_delivery_zones` + `/zones`
  CRUD (ADMIN mutate; driverIds validated tenant-scoped) + shared `zoneSchema` +
  deterministic `pointInPolygon` (ray casting) + tests (zones e2e 7, geo unit 3).
  (2) **Controles › Zonas** page — draw polygons on Leaflet (click vertices,
  undo/clear), color + driver assignment. (3) Serviceability at order create:
  `checkServiceability` logs a non-blocking `OUT_OF_ZONE` event when the
  destination is outside all zones; portal address validator returns coverage and
  the "Nuevo envío" form warns. Full API suite green: 37 files / 220 tests.
- **D6 cost/failure analytics** (`7bb4417`…`fcb0c8d`, 3 commits):
  (1) `GET /analytics/failures` aggregates FAILED/REJECTED by standardized reason
  + day; shared `FAIL_REASONS`/`FAIL_REASON_LABELS`; Analítica "Análisis de
  fallos" card. (2) Energy-native `GET /analytics/cost` = Σ(routeHours×driverCost)
  + Σ(kWh×energyTariff) ÷ deliveries (kWh via new shared `evKwhForKm`); tenant cost
  config (additive Tenant columns + `/controls/cost`, migration
  `20260621000000_tenant_cost_config`). (3) Controles › Costos page + Analítica
  cost card. Full API suite green: 39 files / 225 tests.

**Phase D Tier-1 (D1–D6) is COMPLETE** — strategy selector, configurable POD,
Services/SLA, multi-depot, delivery zones, cost/failure analytics.

**Tier-2 §7 notification engine COMPLETE** (`f9d7313`, `ee23052`, 2 commits):
- Public-tracking **privacy tiers** — `TRACKING_TIERS` (ETA_ONLY/ETA_POSITION/
  FULL) on `Tenant` (migration `20260622000000`); `/track/:token` gates driver
  live location (FULL only) + route queue position (ETA_POSITION/FULL); Track.tsx
  renders per tier; Controles › Seguimiento (`/controls/tracking`). e2e (5).
- Configurable **per-event B2B notifications** — `NOTIFICATION_EVENTS` +
  `MessageTemplate` (event→enabled+body, migration `20260623000000`); `notifyClient`
  gates disabled events and renders bodies (shared `renderTemplate`); 3 lifecycle
  call sites tagged; Controles › Notificaciones (`/controls/notifications`).
  Webhook `event` contract preserved. e2e (4). Full API suite: 41 files / 234.
- **Tier-2 §8 developer platform CORE COMPLETE** (`bac0d3b`, `ec01038`, `c20dd67`,
  3 commits):
  - **Webhooks** — `Webhook` model (url, server secret, events[], enabled;
    migration `20260624000000`); `emitWebhookEvent` signs each delivery
    (HMAC-SHA256, `x-moveos-signature`) and POSTs to subscribed webhooks; fired at
    OUT_FOR_DELIVERY/DELIVERED/FAILED; `/developer/webhooks` CRUD + `/:id/test`.
    These use NOTIFICATION_EVENTS natively (clean), so the legacy per-client
    webhook contract stayed untouched. e2e (5, HMAC verified).
  - **API keys + ingestion** — `ApiKey` model (SHA-256 hash + prefix + scopes;
    migration `20260625000000`); `/developer/api-keys` CRUD (plaintext shown once);
    `/ingest/orders` authenticates by API key + `orders:write` scope → createOrder
    (the order-ingestion scale unlock). e2e (5).
  - **Integraciones page** (Controles, ADMIN) for both.

**Tier-2 §9 custom stop properties COMPLETE** (`5e07206`, `fafd685`, 2 commits):
- `CustomProperty` model (name + `visibleToDriver`/`visibleToRecipient`;
  migration `20260626000000`) + `Order.customFields Json`; shared
  `customPropertySchema`, `customFields` on createOrder/portalCreateOrder, and
  `CUSTOM_PROPERTY_CAPS` per plan (FREE 3 / PRO 10 / ENTERPRISE 50) +
  `customPropertyCap()`.
- `/custom-properties` CRUD (GET returns items + cap context for upsell;
  POST/PATCH/DELETE ADMIN). POST enforces the per-plan cap → 409
  `CUSTOM_PROPERTY_LIMIT` (the Tier-3 upsell hook). `createOrder` persists only
  keys that are existing tenant properties (tenant-safe; unknown keys ignored so
  imports/API stay resilient).
- Surfacing: `selectVisibleFields`/`loadVisibleProperties` enforce per-field,
  per-audience exposure — driver `GET /routes/driver/today` embeds
  visible-to-driver fields labeled per stop and **never** ships the raw JSON;
  public `/track/:token` embeds visible-to-recipient fields (all privacy tiers);
  portal `GET /portal/custom-properties` + portal createOrder carry the values.
  Frontends: Controles › Campos personalizados (CRUD + cap/upsell banner),
  Pedidos (manual form + CSV column-by-name mapping + per-field template column +
  expanded-row display), client portal form, driver StopCard, Track page.
- e2e `customProperties.test.ts` (9). Full API suite green: 44 files / 253 tests.

**Tier-2 §10 driver permissions layer COMPLETE** (`6d46c9f`, 1 commit):
- `DriverPermissionPolicy` (singleton per tenant: `navApp` INTERNAL_GMAPS|WAZE|
  GOOGLE + `allowEditDispatcherRoutes`/`allowCreateRoutes`/`allowEditStartedRoutes`
  + `granular Json`; migration `20260627000000`). Shared `NAV_APPS` + labels,
  `driverPermissionPolicySchema`, `defaultDriverPermissionPolicy`.
- `/controls/driver-permissions` GET (any tenant user — the driver app reads it;
  no row → defaults) + PATCH (ADMIN upsert). Tenant-scoped.
- Web: Controles › Permisos de conductor (ADMIN). Driver app: applies `navApp` to
  the StopCard nav deeplinks (preferred app first; both stay available), cached
  in localStorage for offline. The route-permission flags are the configured
  policy the (follow-on) driver route create/edit flows will consume.
- e2e `driverPermissions.test.ts` (7). Full API suite green: 45 files / 260 tests.

(Phases B vehicle types + C AI optimization were completed by prior sessions.)

## What's left

**Tier 2 (docs/04 §11), build next:**
1. **Barcode scanning** (§11) at load-out + delivery — `ScanEvent { tenantId;
   orderId; type (LOAD|DELIVER|PICKUP); barcode; scannedAt }`. The driver app
   already scans at pickup/delivery (`/routes/stops/:id/scan` → SCANNED/
   SCAN_MISMATCH order events); §11 adds the LOAD (depot manifest verification)
   use + a persisted ScanEvent chain-of-custody + a loading manifest on Rutas.

**§8 connectors (deferred):** Shopify/Zapier + VTEX/Mercado Libre adapters build
ON the webhooks+API-keys+ingestion core above (App settings › Integrations).
Also: standardizing the *legacy* per-client webhook `event` field to
NOTIFICATION_EVENTS is still open (breaking; would need b2b.test.ts updated) —
the new /developer webhooks already use the standard events.

**Fast-follows (deferred):**
- D4: global **depot selector in the web header** scoping Pedidos/Rutas/Mapa/
  Analítica (orders carry no depot → scope via the route's depot), a depot column
  on Rutas, nearest-depot auto-assignment; expose `Vehicle.homeDepotId` /
  `Driver.depotId` in their edit forms.
- D5: **assignment prefers a zone's drivers** (optimizer hint), and tie the
  coverage signal into the demand-heatmap AI feature.

**Tier 3 (docs/04 §12–14, later):** usage metering + feature-flag upsell;
tenant-facing billing (invoices, plan/tax-ID); guided onboarding (depot setup →
checklist → connect driver app via QR).

**Phase E — feature hardening (docs/05, not started):** global typed-error
toasts + retry, i18n sweep (admin/portal/Track), remaining Driver/Web/Admin
stories, design tokens on every touched screen.

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
