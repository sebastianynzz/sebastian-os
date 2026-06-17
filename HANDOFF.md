# MoveOS — Session Handoff

Branch: `claude/sleepy-ride-3bkdbn` (pushed through `6d22501`).
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
- **Phase C (8 stories)** — error boundaries (web/admin/driver);
  tenant-isolation test (`isolation.test.ts`); i18n helpers
  (`apps/web/src/format.ts`, dispatcher pages only); driver PWA update toast
  (`sw.template.js`/`sw.ts`/`UpdateToast`); offline-queue hardening (driver
  `api.ts` + `OfflineQueue.tsx`); fail-evidence + POD-evidence enforcement
  (`failStopSchema`/`submitPodSchema` refines + tests); deliver geofence feedback.

**WHAT'S LEFT (Phase C, doc order):**
1. Finish **Part 4 cross-cutting**: typed-error toasts + retry; performance
   (pagination/virtualization/memoization); a11y & responsive; i18n for
   portal + Track + admin; idempotency audit; broader observability.
2. **Part 1 Driver** (remaining): auth/login (offline re-open, token refresh,
   "sesión expirada", network-vs-bad-creds); today's route
   (stale-while-revalidate, skeletons, pull-to-refresh); start-route
   double-guard; StopCard states/ETA/re-sequencing; client-configurable POD +
   continuously-live geofence (plumb geo ref + poll); GPS battery-aware
   interval/accuracy filter; POD photo upload retry/storage fallback; SOS
   confirm window/re-send; nav deeplink; connection-status indicator, dark mode,
   tap targets.
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

**Next story:** continuously-live geofence on the driver deliver sheet (plumb the
`geo` ref into the sheet + poll), or pick another from the list above.
