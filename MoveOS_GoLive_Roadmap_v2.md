# MoveOS — Go-Live Roadmap v2 & Feature Definitions

**Goal:** ship the best version of the product that can go live with first logos, with the connection infrastructure in place — without over-building. The roadmap is phased so that **Phase 0 + Phase 1 = the go-live bar**; Phases 2–3 are what you grow into once customers are on it.

**Principle for this run:** every Phase 1 item is justified by "a paying tenant or your own FaaS fleet cannot operate a day without it." Everything that's merely impressive moves to Phase 2+. AI/moat features are flagged ◆.

---

## ⚡ HARD PRODUCT CONSTRAINT — MoveOS is EV-only

MoveOS serves electric vehicles exclusively. There is no internal-combustion (ICE) fleet, ever. This is a positioning decision, not a limitation — it makes range, charging, and zero-emissions first-class concerns instead of edge cases, and it is a core differentiator. Treat the following as rules when implementing any feature:

1. **Every vehicle is electric.** No fuel level, no fuel cost, no ICE maintenance. The vehicle data model is EV-native: `batteryKwh`, `nominalRangeKm`, live `soc`, battery temp, charge state, regen.
2. **Telematics is EV telematics.** Ingest SoC, battery temperature, charge/discharge state, kWh consumed, and regen — not fuel %, coolant temp, or RPM-as-engine-load. Where ICE CAN fields exist in the schema, treat them as no-ops/optional and do not surface them in EV UI.
3. **Range & charging are CORE, not an optional module.** EV_MANAGEMENT should be part of the mandatory core for every tenant, because an EV-only operation cannot run without range-aware routing and charge planning. Do not gate range/charging behind a paid toggle.
4. **Range-aware routing is the default, not a special case.** The optimizer always enforces usable-range budgets (`estimateUsableRangeKm`: SoC, temperature, payload, elevation, safety margin) and plans charging legs when a route exceeds range.
5. **Pico y placa: EVs are nationally exempt (Ley 1964/2019).** Treat all MoveOS vehicles as exempt by default — and surface this as a selling point ("nuestra flota nunca tiene restricción de pico y placa"). Keep the rule engine, but the EV exemption is the norm.
6. **Sustainability is a headline, not a report.** Zero tailpipe emissions is a primary value proposition. The CO₂ engine's ICE figures exist only as the counterfactual baseline for "emissions avoided" — never to model an actual MoveOS vehicle.
7. **Energy, not fuel, is the cost unit.** Cost-per-delivery, analytics, and (later) billing are computed from kWh and electricity tariffs (incl. time-of-use / demand charges), never fuel price.

Anywhere a feature below mentions vehicles, fleet, range, fuel, maintenance, or cost, apply these rules. EV-specific features are flagged ⚡.

---

## Phase map

| Phase | Theme | Exit criteria |
|-------|-------|---------------|
| 0 · Foundations | Connections + infra wired | Copilot replies; driver app auto-updates; geocoding, WhatsApp, push, OSRM all live; monitoring + spend caps set |
| 1 · Go-Live MVP | Operate a real day, end to end | A merchant ships, a dispatcher plans, a driver delivers with POD, the client tracks — all on real data, with the exceptions cockpit catching problems |
| 2 · Differentiate | The AI moat deepens | Predictive ETAs, POD vision, demand heatmaps, model + flywheel monitoring, billing |
| 3 · Scale | Volume + new revenue | E-commerce connectors, COD/payments, RTO/returns, hardware telematics, multi-city |

---

## Phase 0 — Connection infrastructure (the foundation workstream)

This is the "build the infrastructure for the connections" work. None of it is product surface; all of it must be done before Phase 1 features are trustworthy.

1. **Copilot LLM** — `ANTHROPIC_API_KEY` + `CLAUDE_MODEL=claude-haiku-4-5` in Render; spend cap; prompt-cache the tool schema.
2. **Driver auto-update** — service-worker `skipWaiting()` + `clients.claim()` + cache-version bump, so every release reaches drivers on the next load.
3. **Geocoding** — `GOOGLE_MAPS_API_KEY` (free tier) wired into the cascade; Lupap quote requested in parallel.
4. **Maps/routing** — OSRM deployed with the Colombia OSM extract; Leaflet + OSM tiles confirmed; offline tile caching for the driver. Routing always runs through the EV range model.
   - 4b. ⚡ **Charging directory** — seed the charging-station dataset (depot + public networks like Terpel Voltex, Enel X, EPM, Celsia) so range-aware planning and the driver's nearest-charger view have data on day one; OCPP/live-status integration is Phase 3.
5. **Comms** — Twilio WhatsApp sender approved (Meta business verification can take days — start now); B2B notification templates registered.
6. **Push** — Web Push (VAPID) keys configured for driver + dispatcher.
7. **Observability** — Render deploy alerts, Sentry (free), Google Maps budget alert, Supabase upgrade plan to Pro before the first external tenant.

**Sequencing note:** WhatsApp sender approval and Lupap procurement have external lead times — kick those off on day one even though they land later.

---

## MoveOS Driver — feature definitions

The surface that determines delivery quality and feeds the address moat. Build order favors "smooth driver day" over breadth.

### Phase 1 (go-live)

- **Live re-sequencing** — when dispatch inserts an express stop into an active route, the app re-orders the remaining stops without losing the driver's place or current task.
- **Offline map tiles** — route tiles pre-cached so navigation survives dead zones; the app never goes blank.
- **Barcode / QR scan at pickup + delivery** — scan the parcel to bind it to the stop; prevents wrong-parcel handoffs and creates a chain-of-custody record. Reuses the existing camera.
- ◆ **Off-geofence pin prompt** — when arrival is beyond the geofence radius, prompt the driver to drop the real pin; one tap fixes the address and feeds the graph.
- **Push assignment alerts** — driver is notified the instant a route is assigned or changed (free via web push).
- **Standardized POD + mandatory fail evidence** — already shipped; keep the evidence requirement on disputable fail reasons.
- ⚡ **Live SoC + range-to-complete check** — driver always sees state of charge and a clear "alcanza para terminar la ruta" / "necesitas cargar" indicator computed from `estimateUsableRangeKm`. This is non-negotiable for an EV-only fleet — a driver must never be surprised by an empty battery mid-route.
- ⚡ **Nearest charging station** — one tap to the nearest compatible charger with a Waze/Google deeplink, drawn from the charging directory.

### Phase 2

- ◆ **On-device POD quality check** — lite vision model rejects "no parcel visible" photos before submission.
- ⚡ **Charging stop guidance** — when a route needs a mid-shift charge, the app shows the planned charging stop, target SoC, and estimated dwell time; logs charge start/stop.
- ⚡ **Battery health surfacing** — degradation/usable-capacity hints so drivers and ops know which vehicles are weakening.
- **Earnings / trip history** — per-stop completion, on-time %, and (for gig drivers) payout visibility.
- **Voice confirmation + dark mode** — hands-free deliver/fail confirmation; night-friendly UI for evening routes.
- **Dispatcher chat + broadcast** — two-way messaging ("calle cerrada", "llego en 10").
- **Pre-trip inspection** — odometer/SoC, damage photo, document-status check at shift start.
- **COD collected/short capture + cash-bag total** — lightweight money capture so the FaaS fleet can dogfood; full reconciliation is Phase 3.
- **Red-zone check-in + share-trip** — safety prompts in flagged zones, rides existing deviation logic.

### Phase 3

- **Gig driver onboarding** — self-serve sign-up, document/cédula capture, background-check hook.
- **Scorecards + incentives** — performance scoring (on-time, success rate, POD quality), streaks/bonuses.
- **Vehicle swap mid-shift + end-of-shift reconciliation** (undelivered, cash handoff, vehicle check-in).

---

## MoveOS Admin — feature definitions

You wear three hats here: platform operator, FaaS dispatcher, and the person watching the moat compound. This plane must be excellent because you use it daily.

### Phase 1 (go-live)

- ◆ **Flywheel monitor** — address-graph growth, hit-rate by city, model coverage; the screen that proves the moat is real (and your investor demo).
- **Integration health** — live status of Twilio, Google/Lupap, OSRM, LLM, Supabase; one place to see what's degraded.
- **Tenant onboarding wizard** — provision a tenant with the right module preset, seed an admin user, set branding — repeatable, not ad-hoc.
- **Support console + impersonation (audited)** — view a tenant's state and act on their behalf to support them, with every action in the audit log.

### Phase 2

- **Billing + usage metering** — meter deliveries/seats/messages per tenant, generate invoices, manage plans. Turns the module model into revenue.
- ◆ **Model performance dashboard** — address accuracy, ETA error, POD-vision precision over time; how you know the AI is actually working.
- **Feature flags / rollout control** — gate features per tenant or roll out gradually; de-risks every future release.
- ⚡ **Energy & emissions analytics** — kWh per delivery, energy cost per route, cost-per-km, and emissions-avoided vs an ICE baseline, per tenant and fleet-wide. This is both an ops metric and a sustainability sales asset.

### Phase 3

- ⚡ **Charging infrastructure management (OCPP)** — manage depot and partner chargers, availability, and energy contracts; integrate charge-point operators for live status.
- ⚡ **Battery fleet health** — track usable capacity / degradation across the fleet to drive replacement and warranty decisions.
- ◆ **Tenant health scores** — usage + outcome signals that flag churn risk and expansion opportunities.
- ◆ **City pin promotion** — promote learned pins from your FaaS fleet into the shared city graph so new tenants start warm (the cold-start solver).
- **Module pricing config, BI / data export, RNDC compliance module** (Colombian regulatory reporting), tenant announcements / changelog.

---

## MoveOS Web (dispatcher) — feature definitions

The command center. Strong bones already; this run defines the operating surface that makes a dispatcher fast.

### Phase 1 (go-live)

- ◆ **Exceptions cockpit** — one prioritized feed of everything going wrong (late, stuck, deviated, failed, low-battery, address-unconfirmed) with one-click actions. The dispatcher's home screen.
- ◆ **Address triage queue** — low-confidence addresses surfaced before planning; confirm a pin and it's fixed for good.
- ◆ **Copiloto panel** — natural-language planning and "¿por qué falló la ruta 3?", narrating the optimizer you already have.
- **Dispatch board** — routes by status (planned → dispatched → in progress → done) at a glance, with driver assignment.
- **Failed-delivery → merchant reschedule** — the B2B-clean recovery path; flag it, the merchant owns the consumer touch.
- ⚡ **Range-aware planning (default)** — every plan enforces usable-range budgets and flags any route that can't finish on current SoC, with the reason exposed in the optimizer's `excludedVehicles[]`. Low-battery vehicles are surfaced before dispatch.
- ⚡ **Fleet SoC board** — live state-of-charge per vehicle so the dispatcher dispatches the right vehicle to the right route length.

### Phase 2

- **Manual route editing** — drag stops between routes, lock attended stops, reorder by hand when the dispatcher knows better than the solver.
- ⚡ **Charging-window & depot-charge planning** — schedule which vehicles charge when (overnight depot + mid-shift), respecting time-of-use electricity tariffs and demand charges; plan routes around charge availability.
- ⚡ **Charging-station directory + OCPP status** — live charger availability (depot + public) feeding both planning and the driver's nearest-charger view.
- **Wave planning + cutoffs** — AM/PM waves with order cutoff times; how real urban ops batch the day.
- **Zone editor + SLA monitor** — draw delivery zones, set per-client SLAs, watch breaches live.
- **Bulk actions** — reassign / cancel / reschedule many orders at once.
- ◆ **Predictive ETA** — ML ETAs from your ping history feeding the cockpit's "will be late" signal.
- ◆ **Demand heatmap** — delivery density + failure hotspots by zone, tied to the address graph.
- **Dispute / POD console** — searchable POD gallery with geofence flags for dispute defense.

### Phase 3

- **Returns / RTO queue** — reverse-logistics workflow for failed/refused deliveries (big P&L lever in LatAm).
- **Rate cards + client invoicing** — shipment-level pricing (zone/weight/dimensional) and per-client billing.
- **Scheduled reports / report builder, route replay** (historical playback for audits and coaching), **recurring route templates**.

---

## What "go-live" actually requires (the minimum bar)

Cut everything else and you can still take a first logo live with:

**Phase 0 (all of it) + Phase 1:**

- **Driver:** live re-sequencing, offline tiles, barcode scan, off-geofence pin prompt, push, POD.
- **Web:** exceptions cockpit, address triage, copiloto, dispatch board, failed→reschedule.
- **Admin:** flywheel monitor, integration health, onboarding wizard, support console.

That set lets a merchant ship, a dispatcher run the day with AI assistance, a driver deliver reliably offline, and you operate and support it — which is a complete, sellable loop. Everything in Phases 2–3 makes it better or bigger, not viable.

---

## Suggested cadence

- **Phase 0:** ~1–2 weeks (mostly config + the SW fix; WhatsApp/Lupap approvals run in the background).
- **Phase 1:** the real build; size it against your team, but it's a focused list, not the whole catalog.
- **Phases 2–3:** pull forward whichever item a design-partner customer is willing to pay for — let real demand reorder them.
