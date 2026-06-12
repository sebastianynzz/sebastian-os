# MoveOS

**Plataforma SaaS modular de última milla para Colombia y LatAm.**

Modular last-mile delivery SaaS built Colombia-first: informal-address
geocoding, pico y placa aware route optimization, motorcycle-fleet support,
cargo-security alerts and EV range management — packaged as a thin mandatory
core plus per-tenant toggleable modules.

> Scope note: MoveOS is **delivery software only** — it does not process,
> collect or reconcile payments of any kind.

## Monorepo layout

```
packages/
  shared/       Domain types, module catalog, Zod schemas, geo helpers
  optimizer/    VRP solver: nearest-neighbor + feasibility-checked 2-opt,
                pico y placa engine (per-city rules), dynamic EV range model
apps/
  api/          Fastify + Prisma/PostgreSQL modular monolith (multi-tenant)
  web/          Dispatcher dashboard (Vite + React + Tailwind, Spanish-first)
  driver/       Driver app (mobile-first PWA-style, offline action queue)
```

## The module model (core + toggles)

Every tenant gets the **mandatory core**: orders, dispatch, driver app,
real-time tracking, basic POD, customer notifications.

Paid modules are toggled per tenant (`ModuleEntitlement`) and enforced at the
API layer — a disabled module returns `403 MODULE_NOT_ENABLED`:

| Module key | What it does |
|---|---|
| `ROUTE_OPTIMIZATION` | Multi-stop VRP: capacity, time windows, **pico y placa** (plate/city/date), vehicle speed profiles (moto vs van), EV range budget |
| `TELEMATICS` | **GPS + CAN-bus telemetry** (RPM/odometer/fuel/temp), live ops map, **engine on/off immobilization** (relay model, speed=0 safety interlock, audit log). Device simulator included; real hardware via aggregator (fase 2) |
| `EV_MANAGEMENT` | SoC tracking, dynamic usable-range estimation (temp/payload/elevation), charging network map |
| `SAFETY` | Panic button, automatic route-deviation alerts (piratería terrestre) |
| `COMPLIANCE_RNDC` | RNDC/MEC manifest generation (fase 2) |
| `CUSTOMER_EXPERIENCE_PRO` | Branded WhatsApp notifications, live tracking page (fase 2) |
| `ANALYTICS_PRO` | Delivery success rate, SPR/SPH productivity, distance, CO₂ estimate |
| `AI_ADDONS` | **Copiloto IA** (Claude): NL planning over the optimizer, "¿por qué falló MV-…?" from the bitácora/POD, flywheel queries — with a confirm-before-acting guard (the model only *proposes*; the UI executes existing endpoints) |

### Address Intelligence & operations cockpit (core)

- **Triage de direcciones** (`/direcciones` + `GET /addresses/triage`): every order
  carries `geoConfidence`; low-confidence pins are reviewed *before* planning —
  fix 12 addresses, not 12 failed deliveries. Dispatcher pin fixes, driver
  pin-drops (nudged when arrival is >300 m off) and portal validation-at-entry
  all feed the learned `AddressPin` graph.
- **Geocoding cascade** is now learned graph → Lupap (`LUPAP_API_KEY`) → Google
  (`GOOGLE_MAPS_API_KEY`) → mock, with per-source daily counters: the **graph
  hit rate** (paid calls avoided) is tracked as a core unit-economics metric and
  visualized in the platform admin's **Data flywheel** page.
- **Cockpit de excepciones** (`/excepciones`, the staff home screen): one
  prioritized queue — panic, route deviations, late routes, silent vehicles,
  low-battery EVs, failed deliveries and unconfirmed addresses — each with a
  one-click action.
- **Recuperación B2B**: dispatcher flags a failed delivery → the *merchant* is
  notified and reschedules from their portal (new linked order). The end
  consumer is never contacted.
- **Driver app**: Waze/Google Maps deeplinks per stop, mandatory evidence photo
  on disputable failures (ausente/rechazo), on-device POD quality check
  (dark/blurry photos rejected at the source) and live route re-sequencing.

Colombia-specific touches built into the core:

- **Tracking number + bitácora**: every order gets a human-readable guía
  (`MV-XXXXXXXX`) and an auditable event trail (created → geocoded → assigned
  → dispatched → in transit → delivered/failed, notifications) — end-to-end
  traceability, expandable from the orders table.
- **CSV bulk import** with downloadable template, plus the `/orders/bulk` API.
- **Learned address graph** (`AddressPin`): every geo-stamped successful POD
  teaches the geocoder the real GPS pin for informal addresses
  ("frente al colegio San José") — a compounding data moat.
- **Pico y placa engine**: configurable per city; Bogotá (even/odd days,
  motos exempt) and Medellín (digit rotation) ship as defaults; EVs exempt
  nationally (Ley 1964/2019).
- **Document compliance**: SOAT / técnico-mecánica expiry alerts per vehicle.
- Spanish-first UI and WhatsApp-ready notification adapter.

## Quick start

Requires Node 20+, pnpm, and PostgreSQL (or Docker).

```bash
pnpm install
docker compose up -d                  # PostgreSQL 16 on :5432
cp .env.example apps/api/.env
pnpm --filter @moveos/api db:generate
pnpm --filter @moveos/api db:push
pnpm db:seed                          # demo tenant with Bogotá data

pnpm dev:api      # API on :3000
pnpm dev:web      # tenant dashboard on :5173
pnpm dev:driver   # driver app on :5174
pnpm dev:admin    # platform admin panel on :5175

# Telemetry demo (no hardware): drives the seeded vehicles, streams GPS + CAN,
# and executes engine on/off commands — watch the "Mapa en vivo" page.
pnpm --filter @moveos/api sim
```

The **Mapa en vivo** page shows vehicles moving in real time with per-vehicle
telemetry (speed, RPM, fuel, SoC, engine state) and an **engine on/off**
control. Try to immobilize a moving vehicle — the API refuses (speed=0 safety
interlock); stop it in the simulator and the command goes through, with the
device acknowledging back. See `docs/ARCHITECTURE_TARGET.md` for the
phone-gateway vs hardwired-device vs aggregator design.

Demo credentials (seed):

| Email | Password | Role |
|---|---|---|
| `admin@demo.moveos.co` | `moveos123` | ADMIN |
| `despacho@demo.moveos.co` | `moveos123` | DISPATCHER |
| `carlos@demo.moveos.co` | `moveos123` | DRIVER (moto) |
| `maria@demo.moveos.co` | `moveos123` | DRIVER (e-van) |
| `cliente@demo.moveos.co` | `moveos123` | CLIENT (portal de Tienda Moda Express) |
| `ops@moveos.co` | `moveos123` | PLATFORM OPERATOR (admin panel :5175) |

MoveOS is **B2B**: the driver confirms delivery to the **business client** that
originated the shipment (via webhook / WhatsApp / email / in-app feed), not to
the end consumer. Manage business clients under **Clientes** in the dashboard.

Business clients also get a **self-service portal** (same login page, CLIENT
role): they create orders with pickup at their registered address, follow them
live, copy the public tracking link for their end consumer, and see a monthly
**green report** (CO₂ + savings vs an ICE baseline). The tenant-wide version
lives under **Sostenibilidad** (Analítica Pro module).

Live views (map, safety alerts, orders, public tracking page, platform FaaS
fleet) are pushed over **SSE** (`/realtime/stream`, `/track/:token/stream`) —
no fast polling; a slow fallback poll remains in case the stream drops.

## Tests

```bash
pnpm --filter @moveos/optimizer test   # unit tests: VRP, pico y placa, EV range
pnpm --filter @moveos/api test         # E2E: register → plan → deliver → audit,
                                       # portal CLIENT, informe verde, SSE
```

The API test suite needs `DATABASE_URL` pointing at a Postgres with the schema
applied (`pnpm --filter @moveos/api db:push`).

## Demo flow (5 minutes)

1. Log in to the dashboard as admin — the seed has 12 geocoded Bogotá orders
   and a mixed fleet: 2 motos, 1 gas car, 1 electric van.
2. **Planificación** → Optimizar: on an odd-numbered weekday the car with
   plate `JDK457` is excluded by pico y placa; motos and the EV (exempt)
   absorb the orders.
3. **Rutas** → assign a driver and dispatch (customers get notified).
4. Open the driver app as `carlos@…` → start the route → deliver stops with
   geo-stamped POD; deliveries work offline and sync later.
5. **Módulos** → toggle modules on/off and watch the nav and APIs react.

## Screenshots

Captured from the running product with the seeded demo data:

| | |
|---|---|
| ![Planificación](docs/capturas/planificacion.png) Route planning: `JDK457` excluded by pico y placa; motos + EV absorb the orders | ![Rutas](docs/capturas/rutas.png) Dispatched routes with per-stop POD and status |
| ![Módulos](docs/capturas/modulos.png) Per-tenant module toggles — nav and APIs react instantly | ![Bitácora](docs/capturas/bitacora.png) Order bitácora: tracking number + full auditable event trail |

<img src="docs/capturas/driver.png" width="280" alt="App de conductor: paradas, entregas, fallos y botón SOS" />

## Documentation

- [docs/MASTER_ROADMAP.md](./docs/MASTER_ROADMAP.md) — full audit & roadmap by
  surface (driver app / tenant SaaS / platform admin / telematics), engineering
  lanes, security/compliance, integrations, stakeholders.
- [docs/ARCHITECTURE_TARGET.md](./docs/ARCHITECTURE_TARGET.md) — target
  architecture, the telemetry plane, GPS/CAN/engine hardware design, hosting.
- [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) — how to deploy (Supabase DB is
  already provisioned) and the security hardening notes.
- [AUDIT.md](./AUDIT.md) — technical audit with process diagrams.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — original design decisions.
