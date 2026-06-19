---
name: moveos-architecture
description: Use when adding or modifying ANY feature in the MoveOS monorepo — explains the modular-monolith conventions (module gating, tenant isolation, roles, realtime, event bitácora) that every change must follow.
---

# MoveOS Architecture Conventions

MoveOS is a multi-tenant last-mile SaaS: Fastify + Prisma API (`apps/api`),
dispatcher dashboard (`apps/web`), driver PWA (`apps/driver`), platform admin
(`apps/admin`), pure-TS VRP optimizer (`packages/optimizer`), shared Zod
schemas/enums (`packages/shared`).

## Non-negotiable rules for every API change

1. **Tenant isolation**: every query filters by `request.user.tenantId`.
   Every new table carries `tenantId`. Never trust an id from the client
   without scoping it to the tenant.
2. **Module gating**: paid features register behind
   `requireModule("<KEY>")` (`plugins/entitlements.ts`) and return
   `403 MODULE_NOT_ENABLED`. Core features (orders, routes, addresses,
   exceptions, portal) never gate. Module keys live in
   `packages/shared/src/modules.ts` (`MODULE_CATALOG`).
3. **Auth guards** (`plugins/auth.ts`): `app.authenticate` (staff+driver,
   blocks CLIENT), `app.authenticateClient` (portal), `requireRole(...)`
   for mutations, `requirePlatformAdmin` for `/platform/*`. DRIVER may only
   touch its own routes/stops (see `findStopForUser`).
4. **Bitácora**: every order state change logs an `OrderEvent` via
   `logOrderEvent` (`services/orderEvents.ts`). Add new event types to the
   `OrderEventType` union there.
5. **Realtime**: after mutating orders/vehicles/alerts, emit via
   `services/realtime.ts` (`emitOrderUpdate`, `emitTenant`,
   `emitPlatform`). Frontends subscribe with `useRealtimeReload` (SSE with
   slow fallback poll) — never add fast polling.
6. **Enums as strings** validated by Zod/TS unions in `@moveos/shared` —
   never Prisma enums. Schema changes need BOTH `schema.prisma` AND a
   hand-written additive SQL file in `prisma/migrations/<ts>_<name>/`
   (CI applies migrations to a fresh Postgres — they must match the schema
   exactly). Run `pnpm --filter @moveos/api db:generate` after schema edits.
7. **B2B recipient rule (firm)**: notifications go to the *merchant client*
   (`notifyClient`, `Client.notifyChannel`), NEVER to the end consumer.
   Failed-delivery recovery: staff flags (`POST /orders/:id/recovery/flag`)
   → merchant reschedules from portal (`POST /portal/orders/:id/reschedule`).
8. **No payments**: MoveOS records deliveries and evidence, never money.

## Frontend conventions

- Spanish-first UI. Reuse `components/ui.tsx` (Card, PageHeader, Banner,
  Button, StatusBadge, inputClass, table classes) — don't restyle ad hoc.
- New dashboard page = file in `apps/web/src/pages/` + route + an item inside
  the right `NAV_GROUPS` bucket in `App.tsx` (the staff sidebar is an ordered,
  collapsible cascade: Pedidos → Planificación → En vivo → Flota → Análisis →
  Configuración). Set `module:` if gated, `roles:` if restricted; a group with
  no visible items is hidden. Staff home is `/excepciones`.
- Driver app is offline-first: ALL mutations go through `apiOrQueue`
  (queues network failures in localStorage, surfaces 4xx). Never use bare
  fetch for driver actions.
- Strict tsc with `noUncheckedIndexedAccess` — indexing returns
  `T | undefined`.

## Verify before committing

`pnpm -r build` (strict tsc + vite for all packages) and
`pnpm --filter @moveos/optimizer test`. API e2e needs Postgres
(`DATABASE_URL` + `db:push`); CI runs it on a fresh DB.
