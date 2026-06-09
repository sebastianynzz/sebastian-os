# MoveOS — Deployment Guide

MoveOS is **not** an all-Vercel app. The telemetry/IoT plane needs a
persistent server (long-lived connections, background ingestion) that
serverless functions can't host. The topology splits accordingly.

## Topology

| Component | Host | Notes |
|---|---|---|
| Tenant dashboard (`apps/web`) | **Vercel** / Cloudflare Pages | Static SPA, `vercel.json` provided |
| Driver app (`apps/driver`) | **Vercel** / Cloudflare Pages | Static SPA, `vercel.json` provided |
| API + telemetry (`apps/api`) | **Railway / Render / Fly** | Persistent Node server; `Dockerfile` + `render.yaml` provided |
| Database | **Supabase** (provisioned ✓) / Neon | Managed Postgres |
| Object storage (POD photos) | Cloudflare R2 / S3 / Supabase Storage | Pending (POD currently external URL) |

## Status of this preview

- ✅ **Database is LIVE** — Supabase project **"Move OS"**
  (`mervcbeedbcruqcipuvr`, region us-west-2). The full 15-table schema has
  been applied. URL: `https://mervcbeedbcruqcipuvr.supabase.co`.
- ⏳ **API host** — needs one deploy step (below). This build environment
  can't host a public persistent server; you complete it with a single
  command on your hosting account.
- ⏳ **Frontends** — deploy after the API URL exists (they read `VITE_API_URL`).

### ⚠️ Security finding from provisioning (Row Level Security)

Supabase flagged that the 15 tables have **RLS disabled**. What this means and
what to do:

- **Why it's mitigated today:** MoveOS clients never talk to Supabase
  directly with the anon key — they call our Fastify API, which connects as
  the Postgres owner and enforces `tenantId` scoping in application code. The
  anon/`authenticated` roles (PostgREST/supabase-js) are simply not used.
- **Hardening (recommended before real customer data):** either
  **(a) disable the Data API/PostgREST** on this project (Settings → API), so
  the anon key exposes nothing — simplest given we use direct Postgres only;
  or **(b) enable RLS** as defense-in-depth. Prisma (owner role) bypasses RLS,
  so enabling it does **not** break the API; it only blocks the anon roles.
  RLS SQL is in the Supabase advisor and tracked in `AUDIT.md` §7 / roadmap.

## Step-by-step

### 1. Database (done — or replicate on Neon)
Schema is already applied on Supabase. Get the connection string from
Supabase → Project Settings → Database → Connection string (URI, "session"
pooler, `sslmode=require`). This is your `DATABASE_URL`.

### 2. API → Render (one command)
```bash
# from repo root, with render CLI authenticated
render blueprint launch     # reads render.yaml
```
Then set the non-synced env vars in the Render dashboard:
`DATABASE_URL` (Supabase URI), `CORS_ORIGINS`
(`https://<your-web>.vercel.app,https://<your-driver>.vercel.app`).
`JWT_SECRET` is auto-generated. The container runs `db:push` on boot, then
starts the API. Health check: `/health`.

> Railway / Fly alternative: `railway up` (uses `apps/api/Dockerfile`) or
> `fly launch`. Any container host works; the only requirement is a
> persistent Node process (not serverless).

### 3. Seed (first deploy only)
```bash
DATABASE_URL="<supabase-uri>" pnpm --filter @moveos/api db:seed
```
Creates the demo Bogotá tenant + users (`admin@demo.moveos.co / moveos123`).

### 4. Frontends → Vercel
For each of `apps/web` and `apps/driver`:
```bash
cd apps/web && vercel --prod    # vercel.json handles the monorepo build
```
Set `VITE_API_URL=https://<your-api-host>` as a build-time env var in each
Vercel project.

### 5. Try it from your phone
Open the deployed driver app URL on your phone, log in as
`carlos@demo.moveos.co / moveos123`, and the dashboard on your laptop — both
hit the same live API.

## Env matrix

See `.env.production.example`. Required for the API: `NODE_ENV=production`,
`JWT_SECRET` (≥32 chars — the app refuses to boot otherwise), `DATABASE_URL`,
`CORS_ORIGINS`. Optional: WhatsApp + geocoding keys (mock adapters used until
set). The telematics aggregator vars apply only when real hardware is wired in
(see `docs/ARCHITECTURE_TARGET.md`).

## Telemetry simulator (demo without hardware)
Locally, with the API running and the demo seeded:
```bash
pnpm --filter @moveos/api sim
```
Drives the seeded vehicles, emits GPS + CAN pings, and executes engine
on/off commands — the **Mapa en vivo** page animates and immobilization works
end to end. In production this same `/telematics/ingest` endpoint receives
real devices via an aggregator (Flespi/Wialon).
