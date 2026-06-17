# MoveOS — Session Handoff

Branch: `claude/sleepy-ride-3bkdbn` (pushed through `7f1f817`).
Paste the prompt below as the first message of a fresh session, and re-attach the
4 spec docs (VehicleTypes, OptimizationAction Registry, Feature Refinement,
vehicleTypeProfiles) — uploads don't carry across sessions.

To resume:

```bash
cd /home/user/move-os && git checkout claude/sleepy-ride-3bkdbn && git pull && claude
```

---

## Kickoff prompt

Continue the MoveOS go-live build on branch `claude/sleepy-ride-3bkdbn` (already
checked out, pushed through commit `eb38dc2`). Read `CLAUDE.md` AND this file's
ledger below first (EV-only, B2B-only, tenant isolation, Spanish/America-Bogotá).
I've re-attached the 4 spec docs.

**Before coding, propose what to work on from "Next story" below and wait for my
pick** — the remaining items are either low-value mechanical, need a dependency
decision, or are underspecified polish. Don't auto-grind; recommend and confirm.

**DONE (committed & green):**
- **Phase A** — 6-config EV vehicle catalog (shared enum + `VEHICLE_TYPE_PROFILES`,
  additive migration + remap, optimizer diff, type-driven `Vehiculos.tsx`).
- **Phase B** — full 9-action AI optimization layer
  (`packages/shared/aiActions.ts`; `apps/api/src/modules/ai/{registry,executor,explain,routes}.ts`;
  `AiProposal` model; `<AiOptimizeButton>`; Copiloto unified via
  `/copilot/actions/confirm` → same `applyProposal`). Actions: optimize_routes,
  reoptimize_route, resolve_addresses (mutating); optimize_load, pick_vehicle,
  optimize_charging, optimize_cold_chain, optimize_schedule, plan_capacity
  (advisory — persistence deferred by product decision).
- **Phase C (initial 8 stories)** — error boundaries (web/admin/driver);
  tenant-isolation test (`isolation.test.ts`); i18n helpers
  (`apps/web/src/format.ts`, dispatcher pages only); driver PWA update toast
  (`sw.template.js`/`sw.ts`/`UpdateToast`); offline-queue hardening (driver
  `api.ts` + `OfflineQueue.tsx`); fail-evidence + POD-evidence enforcement
  (`failStopSchema`/`submitPodSchema` refines + tests); deliver geofence feedback.
- **Phase C — Part 1 Driver (9 stories, this session)** all in
  `apps/driver/src/{App.tsx,api.ts}`, gated by `pnpm --filter @moveos/driver build`
  (driver app has no unit harness): continuously-live geofence (geo **ref** +
  2s poll, freshest fix at submit); GPS battery-aware mode (Battery Status API,
  low-power on discharging ≤20%) + accuracy filter (drop >100m/>500m fixes);
  start-route double-guard + error feedback; SOS confirm window (idle→confirm→
  sent, 10s auto-disarm) + re-send; POD photo upload retry-with-backoff (3x,
  skip 4xx); connection-status pill (online/offline); auth session-expiry
  (`SESSION_EXPIRED_EVENT` on 401-with-token → clean re-login) + network-vs-creds
  login copy; today's route SWR cache + first-load skeleton + pull-to-refresh;
  StopCard current-stop ring + SIGUIENTE/EN SITIO (ARRIVED) badge.

**WHAT'S LEFT (Phase C, doc order):**
1. **Part 4 cross-cutting** — DONE: typed-error toast+retry system
   (`apps/web/src/toast.tsx`, adopted by Rutas + Modulos; other pages can adopt
   incrementally — mechanical, low value); i18n single-source Bogotá formatting in
   `@moveos/shared`; idempotent order creation by externalRef (`idempotency.test.ts`).
   STILL LEFT: performance (virtualization/memoization beyond the Pedidos window);
   broad a11y & responsive sweep; broader observability.
2. **Part 1 Driver** — DONE except minor polish (nav deeplink polish; dark mode;
   tap-target a11y audit). **client-configurable POD** shipped in `bc6b830`:
   `Client.podRequired` (`POD_REQUIREMENTS` = PHOTO | RECEIVER_NAME, additive
   migration `20260617000000_client_pod_policy`), enforced server-side on
   `/routes/stops/:id/complete` (422, source of truth), configured on the
   Clientes form, enforced pre-submit in the driver deliver sheet; e2e in
   `podPolicy.test.ts`.
3. **Part 2 Web** — DONE so far: Pedidos CSV import per-row errors (`2c5d40b`,
   `/orders/bulk` returns `{created,failed,results}`, `bulkImport.test.ts`);
   Pedidos windowed server pagination + "Ver más" (`6314895`); Rutas 409
   transition conflicts + status-aware dispatch (`cf15f7d`, `/routes/:id/dispatch`
   404-vs-409); Clientes test-webhook (`0380960`, `POST /clients/test-webhook`,
   `webhookTest.test.ts`); Planificación order filter + bulk select (`8348b1a`).
   Also DONE: MapaEnVivo EV-only telemetry (`306c4df`, dropped RPM/fuel/coolant)
   + follow-vehicle (`0bb5057`); web-wide role-based nav (`b696508`, `roles` on
   NAV_ITEMS, Módulos → ADMIN only). STILL LEFT: Pedidos virtualization;
   Planificación manual stop tweak; map clustering (deferred to admin Flota — needs
   leaflet cluster lib); Seguridad/Ev/Analítica/Sostenibilidad polish;
   Excepciones/Direcciones/Copiloto finishers; Modulos; saved views; responsive.
4. **Part 3 Admin** — DONE: FaaS vehicle assignment via 6-config catalog
   (`17a0171`, type-driven off VEHICLE_TYPE_PROFILES, EV-always); TenantDetail
   plan-change confirm + health badge (`d8199e7`); module dependency graph
   (`333ddd2`, `requires` in MODULE_CATALOG, enable-cascade + 409 disable-block on
   both toggle endpoints, `moduleDeps.test.ts`). last-admin guard already enforced
   backend (`platform/users.ts`). STILL LEFT (all underspecified polish on
   already-working pages — spec before touching): Tenants list; Flota SSE +
   clustering; Métricas; Auditoría; **data flywheel** investor screen;
   integration-health view.
5. **EV-only compliance (cross-cutting, done):** API now rejects ICE vehicle
   creation (`bdef27e`, `createVehicleSchema.isElectric` default true + reject
   false, `evOnlyVehicle.test.ts`); MapaEnVivo no longer shows ICE telemetry.

**PROTOCOL:** one story per chunk; before coding name the files + a 3-5 line plan;
after coding add/extend tests, run type-check + tests, confirm CLAUDE.md
compliance, then commit/push and STOP to summarize. Solvers are deterministic;
the LLM only triggers and explains; confirm-before-mutate on every mutation.

**ENVIRONMENT NOTES:**
- Tests need Postgres, which **stops between turns**. Restart with:
  ```bash
  export PATH=/usr/lib/postgresql/16/bin:$PATH
  pg_isready -h localhost -p 5432 || su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgdata -o '-p 5432' -l /tmp/pg.log start"
  ```
  Then `export DATABASE_URL=postgresql://moveos:moveos@localhost:5432/moveos`,
  `pnpm --filter @moveos/api exec prisma migrate deploy`, then `pnpm -r test`.
- Last green: **optimizer 73 + API 140**; all frontends build; migrations apply
  clean to a fresh DB. (API 140 incl. platform module-dep cascade/block test.)
- Prioritized batch DONE: (1) global typed-error toast+retry (`3aab72e`,
  `apps/web/src/toast.tsx`, adopted by Rutas + Modulos `34ae136`; rest optional);
  (2) i18n single-source Bogotá formatting in `@moveos/shared` (`c32b98e`, fixed
  timezone bug in portal/Track/admin); (3) TenantDetail plan-confirm + health badge
  (`d8199e7`); (4) module dependency graph (`333ddd2`, `requires` in MODULE_CATALOG,
  enable-cascade + 409 disable-block on both toggle endpoints, `moduleDeps.test.ts`).
  DEFERRED by product decision: marker clustering (do with Flota), saved views (UX).
- A **GateGuard** hook fact-gates the first write/edit per file (state
  importers/callers + the user's instruction, then retry the identical call). To
  quiet it: run with `ECC_GATEGUARD=off`.

**Next story (pick one — all are now either low-value or need a spec):**
- Toast rollout is COMPLETE (`080e51e`): dispatcher + portal CRUD/action pages
  all use the shared toast; Login/Track stay inline by design.
- Marker clustering DONE on dispatcher MapaEnVivo (`13466ec`) AND admin Flota
  fleet map (`b74e989` backend + `7f1f817` frontend, option A): Vehicle now
  denormalizes `lastLat`/`lastLng` (fed by telemetry ingest, surfaced in
  `/tenants/fleet/owned`); admin got the leaflet stack + a clustered map above the
  Flota table. Located vehicles plot green/red by engine state; no-fix vehicles
  stay table-only.
- Module-deps UI hint DONE (`933cb9e`): "Requiere: …" shown on gated toggles in
  Modulos + TenantDetail.
- Any **newly-specified** page feature. The remaining Part 2/3 "polish"
  (Seguridad/Analítica/Sostenibilidad/Métricas/Auditoría/Flywheel,
  Excepciones/Direcciones/Copiloto finishers, saved views, perf, a11y sweep)
  is UNDERSPECIFIED — spec the concrete target before touching working code.
Bring up Postgres first (env notes) and keep the `pnpm -r test` gate green.
