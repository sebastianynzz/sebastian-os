# MoveOS — Session Handoff

Branch: `claude/sleepy-ride-3bkdbn` (pushed through `f15cd45`).
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
checked out, pushed through commit `6d22501`). Read `CLAUDE.md` first (EV-only,
B2B-only, tenant isolation, Spanish/America-Bogotá). I've re-attached the 4 spec
docs.

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
1. Finish **Part 4 cross-cutting**: typed-error toasts + retry; performance
   (pagination/virtualization/memoization); a11y & responsive; i18n for
   portal + Track + admin; idempotency audit; broader observability.
2. **Part 1 Driver** (remaining, smaller): **client-configurable POD**
   (merchant configures which proofs each delivery requires — needs a `Client`
   POD-policy field + API + driver enforcement; the continuously-live geofence
   half is DONE); nav deeplink polish; dark mode; tap-target a11y audit.
3. **Part 2 Web** (mostly not started): Pedidos (server pagination/virtualization,
   CSV import per-row errors); Planificación (filters/bulk/manual tweak); Rutas
   (422 handling, status transitions); MapaEnVivo (clustering/follow); Clientes
   (channel-conditional, test webhook); Seguridad/Ev/Analítica/Sostenibilidad
   polish; Excepciones/Direcciones/Copiloto finishers; Modulos; web-wide
   (saved views, role-based nav, responsive).
4. **Part 3 Admin** (not started): TenantDetail (validation, status/plan confirm,
   module toggles + deps, last-admin guard, **FaaS vehicle assignment using the
   6-config catalog**, health); Tenants list; Flota (SSE telematics, clustering);
   Métricas; Auditoría; **data flywheel** investor screen; integration-health view.

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
- Last green: **optimizer 73 + API 124**; all 4 frontends build; migrations apply
  clean to a fresh DB.
- A **GateGuard** hook fact-gates the first write/edit per file (state
  importers/callers + the user's instruction, then retry the identical call). To
  quiet it: run with `ECC_GATEGUARD=off`.

**Next story:** **client-configurable POD** is the highest-value remaining
Part-1 item but is cross-cutting (needs a `Client` POD-policy field + migration +
API + driver enforcement) — bring up Postgres first (see env notes) and run the
full `pnpm -r test` gate. Otherwise pick from Part 2 (Web), Part 3 (Admin), or
Part 4 (cross-cutting). The driver PWA itself is now well-hardened.
