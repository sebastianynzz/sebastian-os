---
name: moveos-ship
description: Use when verifying, migrating, or deploying MoveOS — build/test gates, Prisma migration discipline against the Supabase Postgres, CI behavior, and the P1 roadmap order.
---

# MoveOS — verify, migrate, ship

## Verification gates (run before every commit)

```bash
pnpm -r build                          # strict tsc + vite, all packages
pnpm --filter @moveos/optimizer test   # 23 VRP/picoYPlaca/EV unit tests
pnpm --filter @moveos/api test         # e2e — needs DATABASE_URL + db:push
```

CI (`.github/workflows/ci.yml`) boots a fresh Postgres 16, runs
`db:generate` → `db:migrate:deploy` → `pnpm -r build` → tests. A migration
file that diverges from `schema.prisma` fails CI even if local tsc passes.

## Migration discipline (DB is Supabase Postgres)

- Migrations are hand-written SQL in
  `apps/api/prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql`,
  ADDITIVE only (new columns with defaults, new tables, new indexes).
- After editing `schema.prisma`: write the matching SQL, then
  `pnpm --filter @moveos/api db:generate`.
- Production applies automatically: the API Dockerfile CMD runs
  `db:migrate:deploy` before start (Render). Never run DDL by hand against
  the Supabase project; the `pod-photos` Storage bucket already exists.
- Per Supabase guidance: app access goes through the API's service
  connection (no anon/authenticated grants); don't expose new tables via
  the Data API.

## Environment keys (all optional, graceful degradation)

`ANTHROPIC_API_KEY` (+`COPILOT_MODEL`) Copilot; `LUPAP_API_KEY`,
`GOOGLE_MAPS_API_KEY` geocoding; `SENDGRID_API_KEY`+`EMAIL_FROM` B2B email;
`WHATSAPP_BUSINESS_TOKEN`+`WHATSAPP_PHONE_NUMBER_ID` WhatsApp; `OSRM_URL`
road-network matrix. Mirror additions in `.env.example`,
`.env.production.example`, and `render.yaml`.

## Roadmap order (capability spec — build P1 in this order)

1. API/webhook order ingestion (scale beyond CSV; `POST /orders/bulk`
   already exists for integrators).
2. E-commerce intake: VTEX + Mercado Libre/Envíos first, then Shopify/Woo.
3. At-risk shipment alerts in the portal (Predictive ETA on top of the
   exceptions computation in `services/exceptions.ts`).
4. Cross-tenant pin promotion (new-tenant cold start from city graphs).
5. Recurring routes / wave planning; per-client SLA reports.
6. Redis pub/sub swap for `services/realtime.ts` at horizontal scale.
Deferred by design: payments/COD workflows (model fields only), RNDC
(fase 2), hardware telematics adapters (ingest endpoint is ready).
