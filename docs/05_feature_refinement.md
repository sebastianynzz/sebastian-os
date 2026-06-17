# MoveOS — Feature Refinement & Hardening Plan

Purpose: NOT new features — perfect the ones that already exist. A per-feature hardening pass across the three frontends (Driver, Web, Admin), plus the 6-vehicle-type catalog the optimizer needs. Written to be fed to Claude Code. All work respects CLAUDE.md (EV-only, B2B-only notifications, tenant isolation, Spanish/Bogotá). Treat each bullet as a story with its own acceptance criteria.

## Part 0 — The 6 EV vehicle types (foundation; do first)

Two product lines — Rap Move and IONAx — across 6 configurations. Single source of truth in packages/shared (VehicleType enum + VEHICLE_TYPE_PROFILES); full typed file is vehicle-type-profiles.ts.

| Config (enum) | Line | Reefer | Body | Payload kg | Volume m³ | Range km | Battery kWh | Top speed |
|---|---|---|---|---|---|---|---|---|
| RAP_MOVE_LIGHT | Rap Move | No | Closed box | 115 | 0.5 | 100 | 4.864 | 65 |
| RAP_MOVE_XL | Rap Move | No | Closed box | 250 | 1.6 | 120 | 7.36 | 75 |
| RAP_MOVE_COLD_BOX | Rap Move | Yes — −25°C, frozen | Refrigerated box | 200 | 1.0 | 90 | 7.36 | 75 |
| IONAX | IONAx | No | Closed box | 530 | 3.0 | 130–260 | 11.52 / 23.04 | 75 |
| IONAX_COLD_BOX | IONAx | Yes — −18…+10°C, chilled | Refrigerated box | 530* | 2.8 | 130–260 | 11.52 / 23.04 | 75 |
| IONAX_PICKUP | IONAx | No | Open flatbed | 530 | n/a | 130–260 | 11.52 / 23.04 | 75 |

Cold-chain routing rule: RAP_MOVE_COLD_BOX is frozen-capable (−25°C, GP-1000A) → route FROZEN orders here. IONAX_COLD_BOX is chilled (−18…+10°C, JONWAY XD-250) → route CHILLED orders here. Solvers match order.tempProfile to reefer.modes.

EV range note (confirmed): all published ranges are reefer-on. Use nominalRangeKm as-is; do NOT subtract cooling draw again. coolingDrawKw is for energy/cost analytics only.

Still open: (1) IONAX_PICKUP flatbed bed length × width; (2) confirm IONAX_COLD_BOX payload net vs gross (~157 kg body/unit).

Where it plugs in: enums.ts (the 6 + profiles), travel.ts (per-type speed/duration factors), vrp.ts (capacity sim + excludedVehicles reasons), Vehiculos.tsx (type-driven defaults; reefer config only for Cold Box configs; IONAx battery selector), evRange.ts (type default range), picoYPlaca.ts (all 6 EV-exempt).

## Part 1 — MoveOS Driver (apps/driver)

Auth/login: secure session + offline re-open (cached token); token refresh + "sesión expirada" preserving in-progress route; distinguish network failure from bad credentials.
Today's route: local cache + stale-while-revalidate; skeletons + empty state + pull-to-refresh; correct Bogotá day boundaries.
Start route: guard double-start; geolocation rationale + graceful denied handling.
Stop list/StopCard: clear current/done/pending/failed states + ETA to next; handle live re-sequencing; two-line address, big tap targets.
Deliver: client-configurable POD (photo/sig/OTP/cédula); live geofence feedback + inline pin-fix; reliable multi-photo + offline queue.
Fail: enforce mandatory evidence photo (verify offline can't bypass); optional note; confirm step; explicit REJECTED vs FAILED.
Offline queue: per-action status + manual retry; backoff; persist across kills; ordering; surface permanent 4xx; handle server conflicts.
GPS/telemetry: battery-aware interval; filter low-accuracy; reliable background tracking; re-prompt on revoke.
POD photo: tune compression; upload retry with storage fallback.
SOS: confirm/cancel window; send location+speed; "alerta enviada"; re-send.
Nav deeplink + pin-fix: detect Waze/Google + fallback; accurate GPS capture writing back to the graph.
PWA shell (the "looks the same" fix): service worker skipWaiting() + clients.claim() + cache-version bump + "nueva versión — recargar" toast; offline page, install prompt, icon/splash.
Driver-wide: connection-status indicator, Spanish copy, dark mode, accessible tap targets, non-blocking error toasts.

## Part 2 — MoveOS Web (apps/web)

Theme: every list needs search/filter/sort/pagination + states; every form needs shared-Zod validation + inline geocode feedback; every realtime view needs reconnect.
Modulos: confirm on disabling in-use module; show dependencies; audit.
Pedidos: server pagination + virtualization; search/filters (status/client/city/date); single-create with live geocode preview; CSV import per-row errors + dedupe + progress; bitácora polish + SSE reconnect.
Clientes: channel-conditional fields + "probar webhook/WhatsApp" test; paginate notifications; secure portal credentials; search.
Vehiculos: type-driven defaults from the 6-config catalog; conditional reefer-zone config only for Cold Box configs (RAP_MOVE_COLD_BOX, IONAX_COLD_BOX); IONAx battery-pack selector; doc-expiry filter/sort/reminders; status (active/maintenance/charging).
Conductores: onboarding + license/doc expiry; availability/status; app-login link; performance summary.
Planificacion: order/vehicle selection filters + bulk; clearer map preview; readable grouped exclusion reasons; OSRM ≤120-point cap messaging + fallback; manual tweak before commit.
Rutas: denser route cards; per-stop POD indicators; driver-assignment dedupe; handle 422 INSERTION_INFEASIBLE; status transitions; detail map.
MapaEnVivo: marker clustering; stale-ping indicator; follow-vehicle; layer toggles; SSE reconnect; engine command confirm + in-motion interlock.
Seguridad: severity sort + filters; real-time arrival + sound; ack/resolve polish; click alert → focus on map.
Ev: SoC overview + low-battery flags; range calculator; charging directory search/map; surface reefer energy draw.
Analitica: date-range picker; period-over-period; legible charts; export; states.
Sostenibilidad: printable/exportable CO₂ report; per-client + EV-share + trees clarity.
Excepciones/Direcciones/Copiloto (finish them): Excepciones home-screen (prioritization, one-click actions, filters, snooze, live); Direcciones batch confirm + fast triage; Copiloto streaming + confirm-before-act + history + suggested prompts + graceful "no configurado".
Web-wide: error boundaries, skeletons, saved views, role-based nav, responsive, Bogotá date/number formatting, SSE resilience.

## Part 3 — MoveOS Admin (apps/admin)

Login: platform tokens separated; error states; timeout.
Tenants list: search/filter (plan/status/operator type); accurate usage counts; pagination/sort; status badges.
TenantDetail: company-edit validation; status/plan change confirm + visible instant-suspension feedback; module toggles with dependencies + audit; user mgmt last-admin guard + password-reset UX; FaaS vehicle assignment using 6-config catalog + live telematics; health-at-a-glance.
Flota: performance over platform SSE; filters; live telematics; reconnect; clustering.
Metricas: date-range; per-tenant drill; module-adoption + success-rate; states.
Auditoria: filters (action/actor/tenant/date) + search + export on cursor pagination.
Data flywheel (finish): address-graph growth, hit-rate by city, model accuracy, cold-start lift — the investor screen.
Admin-wide: integration-health view (Twilio, geocoding, OSRM, LLM, Supabase); complete audit coverage; role management.

## Part 4 — Cross-cutting hardening (all apps)

States everywhere (loading/empty/error). Validation parity via shared Zod. Realtime resilience (SSE reconnect + 60s fallback poll). Performance (pagination, virtualization, caching, memoization). Error handling (boundaries, typed Spanish errors, toasts, retry). Offline integrity (queue source of truth; idempotent endpoints). i18n & formatting (Spanish, America/Bogotá, COP). Accessibility & responsive. Security (token handling, rate limits, sanitization, RBAC + verifyTenantToken on every tenant route, requireModule gating). Observability (logging + Sentry). Tests (optimizer units incl. the 6 profiles; API integration + tenant isolation; E2E create→plan→dispatch→deliver).

## How to feed this to Claude Code

Order (each step safe to ship before the next):
1. Vehicle types (Part 0) — additive schema + optimizer factors + conditional Vehiculos UI.
2. Cross-cutting hardening (Part 4) — systemic items before per-feature polish.
3. Driver (Part 1) — PWA service-worker auto-update fix first, then offline-queue, then delivery/fail/pin-fix.
4. Web (Part 2) — Pedidos and Planificacion first, then Rutas/MapaEnVivo, then Excepciones/Direcciones/Copiloto.
5. Admin (Part 3) — TenantDetail and Flota first, then Metricas/Auditoria/flywheel.

Per-task framing: treat each bullet as a story. For each: (a) state current behavior, (b) implement the refinement, (c) add missing loading/empty/error states, (d) add/extend tests, (e) confirm CLAUDE.md compliance (EV-only, B2B-only, tenant isolation, Spanish/Bogotá). Group bullets under one feature into a single PR.

Definition of done for a feature: all three states present, shared-Zod validation, realtime reconnect (if applicable), tests passing, Spanish copy consistent, no cross-tenant leakage.
