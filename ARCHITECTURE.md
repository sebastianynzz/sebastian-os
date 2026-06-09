# MoveOS — Architecture

## Shape: modular monolith, multi-tenant, core + entitlements

A single Fastify API serves all tenants. "Modules" are not microservices —
they are route groups registered behind an **entitlement preHandler**
(`requireModule(<key>)`). Disabling a module for a tenant instantly returns
`403 MODULE_NOT_ENABLED` from its endpoints, and the dashboard hides its nav
entry. This gives the commercial benefits of modular packaging (à la
Gainsight/Route4Me) with zero distributed-systems cost at MVP stage.

```
apps/api/src/
  plugins/auth.ts            JWT (tenantId, role, driverId) + requireRole
  plugins/entitlements.ts    requireModule / isModuleEnabled
  services/geocoding.ts      AddressPin lookup → provider → mock (cascade)
  services/notifications.ts  adapter interface: WhatsApp Cloud API / console
  modules/
    auth, admin(modules), orders, drivers, vehicles, routes, tracking   ← core
    optimization, safety, ev, analytics                                 ← gated
```

Every table carries `tenantId`; every query is scoped by the JWT's tenant.
Roles: `ADMIN` (toggles modules), `DISPATCHER` (plans/dispatches), `DRIVER`
(its own route only).

## The optimizer (packages/optimizer)

Pure TypeScript, no external solver, deliberately simple and inspectable:

1. **Vehicle filtering** — pico y placa check per vehicle/city/date/hour.
   Rules are data (`PicoYPlacaRule`), not code: cities change schemes by
   decree, so rules take a `restrictedDigits(date)` function. EVs are exempt
   nationally; motos exempt in Bogotá.
2. **EV range budget** — `estimateUsableRangeKm` derates nominal range by
   SoC, temperature (cold Bogotá mornings), payload and elevation gain, then
   applies a 15% safety margin. The budget caps total route distance
   including the return to depot.
3. **Construction** — orders sorted by priority then weight; greedy
   cheapest-append over all vehicles with full feasibility simulation
   (capacity kg/m³, time windows with waiting, max 10h shift, range budget).
4. **Improvement** — 2-opt segment reversal accepted only when it reduces
   distance **and** stays feasible (time windows re-simulated).
5. **Explainability** — unassigned orders and excluded vehicles carry
   human-readable reasons; routes carry warnings (e.g. low-SoC EV).

Distances are haversine × 1.4 urban detour factor; speeds are per-vehicle-type
urban averages (moto 22 km/h > car 17 km/h in Bogotá traffic, which makes the
solver naturally prefer motos). Swapping in a road-network engine (OSRM/
VROOM/NextBillion) later only changes the distance/time functions — the
constraint logic stays.

## Colombia-specific design decisions

- **Addresses**: `geocodeAddress` cascade = learned `AddressPin` (per-tenant,
  keyed on normalized address) → external provider (Google/Lupap, pluggable
  `GeocodeProvider`) → deterministic mock for dev. `learnAddressPin` is
  called on every geo-stamped delivery: the address graph compounds.
- **POD**: photo/signature/OTP/geofence types; geofence auto-validates the
  delivery pin within 300 m of the order's coordinates and stores
  `geofenceOk` for dispute defense.
- **Safety**: tracking pings run a deviation heuristic (distance to nearest
  pending stop/depot > 5 km ⇒ one OPEN alert per route); panic endpoint for
  the driver app's SOS button. Designed to later plug into monitoring
  centers/PONAL.
- **No payments by design**: MoveOS is delivery software only; it records
  deliveries and evidence, never money. Payment processing is explicitly out
  of scope (product decision).
- **Enums as strings** (validated by Zod/TS unions in `@moveos/shared`):
  keeps Prisma portable across DB engines and migration-free for new values.

## Driver app: offline-first by necessity

Gig couriers ride through dead zones with data-frugal Android phones. All
mutating actions go through `apiOrQueue`: network failures (TypeError) are
queued in localStorage and flushed on `online` events or every 20 s. Business
errors (4xx) are surfaced, not queued. Telemetry pings every 30 s while a
route is in progress, carrying battery SoC for EVs.

## What is intentionally deferred

- **RNDC module** is catalogued but stubbed: the web-service integration
  (MEC, tiempos logísticos) is fase 2's wedge for mid-market/3PL.
- **Telematics hardware ingestion**: the data model (`TelemetryPing`) is
  device-agnostic; fase 2 adds protocol adapters (Teltonika/Queclink/Wialon
  retranslation) feeding the same table.
- **Postgres row-level security, queues, websockets**: the dashboard polls;
  scale work comes after product-market fit signals.
