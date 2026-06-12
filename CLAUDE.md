# MoveOS — Project Context for Claude Code

This file states the non-negotiable constraints to apply to every change. Read it before planning or writing code.

## What MoveOS is

A modular, multi-tenant, AI-native last-mile delivery SaaS for Colombia/LatAm. Monorepo: Fastify + Prisma API (`apps/api`, modular monolith), pure-TS optimizer (`packages/optimizer`), shared types (`packages/shared`), and three React frontends — dispatcher (`apps/web`), platform admin (`apps/admin`), offline-first driver PWA (`apps/driver`). Sold as a mandatory core plus per-tenant paid modules enforced at the API layer. MoveOS also runs its own electric fleet on this software (FaaS).

## ⚡ HARD CONSTRAINT 1 — EV-ONLY

MoveOS serves electric vehicles exclusively. There is no internal-combustion (ICE) fleet, ever. This is a positioning decision and a core differentiator. Apply these rules to all code:

1. **Every vehicle is electric.** No fuel level, no fuel cost, no ICE maintenance concepts in product logic or UI. Vehicle model is EV-native: `batteryKwh`, `nominalRangeKm`, live `soc`, battery temp, charge state, regen.
2. **Telematics = EV telematics.** Use SoC, battery temperature, charge/discharge state, kWh consumed, regen. Treat ICE CAN fields (fuel %, coolant temp, RPM-as-load) as no-ops; do not surface them in EV UI.
3. **Range & charging are CORE, never an optional paid module.** EV_MANAGEMENT is part of the mandatory core. Do not gate range-aware routing, SoC display, or charge planning behind an entitlement toggle.
4. **Range-aware routing is the default path.** The optimizer always enforces usable-range budgets via `estimateUsableRangeKm` (SoC, temperature, payload, elevation, safety margin) and plans charging legs when a route exceeds range.
5. **Pico y placa: EVs are nationally exempt (Ley 1964/2019).** All MoveOS vehicles are exempt by default; keep the rule engine but the exemption is the norm. Surface it as a selling point.
6. **Sustainability is a headline feature.** Zero tailpipe emissions is a primary value prop. ICE figures in the CO₂ engine exist ONLY as the "emissions avoided" counterfactual baseline — never to model a real MoveOS vehicle.
7. **Energy, not fuel, is the cost unit.** Cost-per-delivery, analytics, and billing derive from kWh and electricity tariffs (incl. time-of-use / demand charges), never fuel price.

If a task description implies ICE behavior (fuel, tank, emissions from our own vehicles), flag the conflict instead of implementing it.

## HARD CONSTRAINT 2 — B2B notifications only

MoveOS never messages the end consumer. Notifications go to the business client (the merchant). Failed-delivery recovery is routed through the merchant, not the recipient. Do not add direct-to-consumer messaging.

## HARD CONSTRAINT 3 — Tenant isolation

Every table carries `tenantId`; every query is scoped by it. Tenant routes use `verifyTenantToken()`; platform routes use `requirePlatformAdmin()`. Never write a cross-tenant query outside the explicit platform/FaaS fleet views.

## HARD CONSTRAINT 4 — Colombia/LatAm + Spanish

User-facing copy is Spanish. Day boundaries are America/Bogotá. Addresses are often informal — the learned Address Graph is the geocoding moat; preserve and feed it (`learnAddressPin`, `AddressCorrection`).

## Conventions

- Shared Zod validators live in `packages/shared/schemas.ts`; domain enums (string unions, DB-portable) in `enums.ts`. Reuse them across API and frontends.
- Module gating via `requireModule(key)`; programmatic checks via `isModuleEnabled()`. (Reminder: range/charging is core, not gated — see Constraint 1.3.)
- Realtime via the SSE bus (`services/realtime.ts`); designed to swap to Redis pub/sub for horizontal scale.
- Driver app is offline-first: network failures queue in localStorage and report `{queued:true}`; business errors (4xx) surface immediately. Keep new driver actions offline-safe.
- The Copilot is a thin LLM layer over existing endpoints with a confirm-before-mutate guard; do not let it execute mutations without explicit confirmation.

## Current focus

Go-live. See the phased roadmap (`MoveOS_GoLive_Roadmap_v2.md`): Phase 0 (connections/infra) + Phase 1 (go-live MVP) is the bar. AI/moat features flagged ◆, EV-specific features flagged ⚡. Don't build Phase 2–3 work unless asked.
