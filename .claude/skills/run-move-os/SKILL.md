---
name: run-move-os
description: Run, start, launch, smoke-test or screenshot MoveOS locally — boots Postgres, seeds the demo, starts the API (3000), dashboard (5173), driver PWA (5174) and admin (5175), drives them with curl + a committed headless-Chromium driver.
---

# Run MoveOS (full stack, headless container)

MoveOS is a pnpm monorepo: Fastify API + three Vite/React apps. The agent
path is: local Postgres 16 → migrate+seed → API in background (smoke with
`smoke.sh`) → Vite dev servers → drive the UIs with `driver.mjs`
(npm-bundled Chromium; the Playwright CDN is blocked here).

All paths below are relative to the repo root. Every command was run and
verified in this container.

## Prerequisites

Already in the container: Node 22, pnpm 10, PostgreSQL 16 server binaries
(`/usr/lib/postgresql/16/bin` — NOT on PATH), `curl`, `jq`. No system
Chrome and no Docker — that's what `driver.mjs` solves.

## Setup + database (once per container)

```bash
pnpm install
id postgres 2>/dev/null || useradd -m postgres
install -d -o postgres -g postgres /var/lib/moveos-pg /var/run/postgresql
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /var/lib/moveos-pg"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/moveos-pg -l /tmp/pg.log start"
su postgres -c "psql -c \"CREATE ROLE moveos LOGIN PASSWORD 'moveos' SUPERUSER;\" -c 'CREATE DATABASE moveos OWNER moveos;'"
cp .env.example apps/api/.env   # los defaults ya apuntan a moveos/moveos@localhost
export DATABASE_URL="postgresql://moveos:moveos@localhost:5432/moveos"
pnpm --filter @moveos/api db:migrate:deploy
pnpm --filter @moveos/api db:seed
```

Demo logins after seed: `admin@demo.moveos.co`, `despacho@`, `carlos@`
(driver), `maria@` (driver), `cliente@` (portal) — all `moveos123`; platform
operator `ops@moveos.co / moveos123`.

## Run (agent path)

```bash
DATABASE_URL="postgresql://moveos:moveos@localhost:5432/moveos" \
  nohup pnpm --filter @moveos/api start > /tmp/api.log 2>&1 &
sleep 6 && curl -s localhost:3000/health        # {"ok":true,...}
bash .claude/skills/run-move-os/smoke.sh        # login + endpoints clave

nohup pnpm dev:web    > /tmp/web.log    2>&1 &  # dashboard :5173
nohup pnpm dev:driver > /tmp/driverapp.log 2>&1 &  # PWA conductor :5174
nohup pnpm dev:admin  > /tmp/admin.log  2>&1 &  # panel plataforma :5175
```

### Browser driver (screenshots + real flows)

```bash
cd .claude/skills/run-move-os && npm install && cd ../../..   # baja Chromium desde npm (~80 MB)
mkdir -p /tmp/moveos-shots
node .claude/skills/run-move-os/driver.mjs shot http://localhost:5173/ /tmp/moveos-shots/login.png
node .claude/skills/run-move-os/driver.mjs shot http://localhost:5173/ /tmp/moveos-shots/excepciones.png admin@demo.moveos.co moveos123
node .claude/skills/run-move-os/driver.mjs triage /tmp/moveos-shots/triage.png
node .claude/skills/run-move-os/driver.mjs shot http://localhost:5174/ /tmp/moveos-shots/conductor.png carlos@demo.moveos.co moveos123
node .claude/skills/run-move-os/driver.mjs flywheel /tmp/moveos-shots/flywheel.png
```

`triage` ejecuta un flujo real: login → cockpit de excepciones → "Abrir
triage" → "Revisar" un pedido → editor de pin Leaflet. Mirar siempre la
captura resultante.

### Direct API invocation

```bash
TOKEN=$(curl -s localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@demo.moveos.co","password":"moveos123"}' | jq -r .token)
curl -s localhost:3000/exceptions -H "Authorization: Bearer $TOKEN" | jq .
```

Mutaciones útiles para demos: `PATCH /addresses/orders/:id/location`
(confirma un pin → baja el conteo de triage y alimenta el flywheel),
`POST /optimization/plans`, `POST /routes/:id/dispatch`.

## Test

```bash
pnpm -r build                          # tsc estricto + vite, 6 paquetes
pnpm --filter @moveos/optimizer test   # 23 unit
DATABASE_URL="postgresql://moveos:moveos@localhost:5432/moveos" \
  pnpm --filter @moveos/api test       # 77 e2e (necesita el Postgres de arriba)
```

Los e2e crean tenants `Test *` que quedan en la BD (visibles en el panel
admin); el seed demo no se ve afectado.

## Run (human path)

`pnpm dev:api` + `pnpm dev:web` y abrir http://localhost:5173 — inútil sin
display; usa el driver.

## Gotchas

- **CDN de Playwright bloqueado** (`playwright install chromium` falla con
  "Download failure"). Por eso el driver usa `@sparticuz/chromium`: el
  binario viene dentro del tarball de npm, que sí pasa la política de red.
- **Teselas OSM bloqueadas**: los mapas Leaflet salen con fondo gris en las
  capturas. Los marcadores y la interacción funcionan; no es un bug.
- **El botón de login de la app de conductor no tiene `type="submit"`** —
  el selector del driver usa `button[type="submit"], form button`.
- **`initdb` rehúsa correr como root** → todo vía `su postgres -c`, y
  `/var/run/postgresql` debe existir y pertenecer a postgres.
- **`pnpm --filter X add <pkg>` poda los node_modules del resto del
  workspace** — vuelve a correr `pnpm install` en la raíz después.
- **Copiloto sin `ANTHROPIC_API_KEY`** responde 503 `COPILOT_NOT_CONFIGURED`
  (el panel lo explica). Exporta la clave antes de arrancar la API para
  probarlo de verdad.

## Troubleshooting

- `Failed to download Chrome for Testing … Download failure` → CDN
  bloqueado; usa este driver (no `playwright install`).
- `pg_ctl: another server might be running` → ya está arriba: `pg_isready`.
- API no responde en :3000 → `cat /tmp/api.log`; un `tsx src/server.ts`
  viejo puede tener el puerto: `pkill -f "tsx src/server"` y relanzar.
- `page.click: Timeout … button[type="submit"]` en la PWA → ver gotcha del
  botón de login.
