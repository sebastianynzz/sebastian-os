# MoveOS — Full Security Audit Report

**Date:** 2026-06-21
**Target repo:** `/home/user/move-os` (branch `claude/kind-goodall-fypvvw`)
**Live URL (production — not probed):** https://moveyow.com
**Methodology:** OWASP Top 10:2025, read-only static analysis, 24-check vibe-coding audit spec, executed by 7 parallel domain subagents and synthesized here.

> **Read-only audit.** No source was modified, no fixes were applied, and no dynamic/intrusive test was run against production. Every dynamic check is recorded as a **MANUAL** finding with copy-paste commands for a staging run. Secrets are redacted to the last 4 characters where they appear.

---

## 0. Stack reconciliation (important — the audit spec's assumptions were corrected against the repo)

The provided `security-audit-spec.json` assumed a **Supabase-client + Vercel + Next.js** app. The repo is materially different, and the audit was adapted to ground truth:

| Spec assumed | Actual (verified) |
|---|---|
| Supabase Postgres + **RLS** for authz | **Fastify + Prisma + PostgreSQL.** No Postgres RLS. Tenant isolation is enforced **100% in application code** (every Prisma query scoped by `tenantId`), per `CLAUDE.md` Constraint 3. |
| Supabase Auth | **Custom JWT** via `@fastify/jwt` (HS256), `plugins/auth.ts`. Bearer tokens in `localStorage`, no cookies. |
| Vercel hosting + Vercel WAF + `vercel.json`/`next.config.js` | **API on Render** (`render.yaml`). **SPAs (`apps/web`, `apps/admin`, `apps/driver`) on Vercel/Cloudflare Pages** (each ships a `vercel.json`). SPAs are pure client-rendered Vite + React. |
| Supabase Storage (edge functions) | **Supabase Storage** used for POD photos (bucket `pod-photos`, **public-read** per `docs/DEPLOYMENT.md`). API is a standalone Fastify server. |

Net effect: the highest-yield issues are **not** RLS policies (there are none) but (a) a vulnerable auth dependency, (b) SSRF via tenant-controlled webhook URLs, (c) a **public** PII storage bucket, (d) rate-limiting/abuse gaps, and (e) a business-logic paywall bypass. Tenant isolation and object-level authz themselves are **strong** — see §3.

---

## 1. Executive summary

**33 distinct findings** after de-duplication (several issues were independently reported by multiple agents and merged).

| Severity | Count |
|---|---|
| 🔴 **Critical** | 1 |
| 🟠 **High** | 6 |
| 🟡 **Medium** | 12 |
| 🔵 **Low** | 14 |
| ⚪ **Info / clean / by-design** | 14 (summarized in §6) |

**Status breakdown:** 30 **Confirmed**, 3 **Likely** (MO-11, MO-21, MO-25), plus **5 MANUAL** live-probe procedures (§7).

**What's strong (do not "fix"):** tenant isolation (every `update/delete`-by-id is preceded by a `findFirst({where:{id, tenantId}})` → 404 guard); JWT claims minted server-side only (no route trusts `tenantId`/`role` from body/query); platform plane fail-closed against tenant tokens; CORS is a strict allowlist (`origin:false` in prod if unset, `credentials` never set); helmet defaults active on the API; password hashing is bcrypt cost-10; no SQL injection (all `$queryRaw` is tagged-template parameterized); no XSS sinks (zero `dangerouslySetInnerHTML`); no hardcoded secrets and a clean git history; no hallucinated/typosquatted dependencies; driver service worker correctly refuses to cache API/PII responses.

**Top priority:** **MO-01** (vulnerable `fast-jwt` in the production auth path), then the **SSRF trio (MO-02)** and the **public POD evidence bucket (MO-03)**.

---

## 2. Findings table

| ID | Title | Severity | Status | Location |
|----|-------|----------|--------|----------|
| **MO-01** | Vulnerable `fast-jwt` in production JWT auth (alg-confusion / empty-HMAC bypass class) | 🔴 Critical | Confirmed | `apps/api/package.json:22` → `fast-jwt@5.0.6` (`pnpm-lock.yaml:1551`); used by `plugins/auth.ts:8` |
| **MO-02** | SSRF via tenant-controlled outbound URLs (3 sinks, incl. response oracle) | 🟠 High | Confirmed | `modules/clients/routes.ts:131-148`; `services/webhooks.ts:38` (+`modules/developer/routes.ts:34-40,63-75`); `services/notifications.ts:87` |
| **MO-03** | POD delivery evidence (PII) served from a **public** Supabase bucket + unauthenticated `/files/` | 🟠 High | Confirmed | `services/storage.ts:82`; `docs/DEPLOYMENT.md:27-28`; `app.ts:76-80` |
| **MO-04** | Global rate limiter is in-memory + no `trustProxy` (IP keying broken behind Render edge) | 🟠 High | Confirmed | `app.ts:55-72` (no `trustProxy`; no shared store) |
| **MO-05** | Ingest order-creation endpoints have no per-route rate limit (abuse / cost / DB flood) | 🟠 High | Confirmed | `modules/ingest/routes.ts:38-77` |
| **MO-06** | Tenant ADMIN can self-enable paid modules (paywall / entitlement bypass) | 🟠 High | Confirmed | `modules/admin/modules.ts:31-89` |
| **MO-07** | No dependency/SCA gate in CI; no Dependabot/Renovate (root cause of MO-01 shipping) | 🟠 High | Confirmed | `.github/workflows/ci.yml`; missing `.github/dependabot.yml` |
| **MO-08** | Stateless JWT cannot be revoked; logout / password-reset / user-delete don't invalidate live tokens | 🟡 Medium | Confirmed | `plugins/auth.ts:8-11`; `modules/platform/users.ts:118-135,167`; no `/logout` |
| **MO-09** | Self-service `/auth/register`: no rate limit/CAPTCHA, unverified email, auto-grants ADMIN | 🟡 Medium | Confirmed | `modules/auth/routes.ts:14-56` |
| **MO-10** | Address `/validate` (paid geocoder) cost-amplification — only the soft global limit | 🟡 Medium | Confirmed | `modules/addresses/routes.ts:63-70` |
| **MO-11** | SPAs (web/admin/driver) have no committed hosting security headers (CSP / frame-ancestors) | 🟡 Medium | Likely | `apps/{web,admin,driver}/vite.config.ts`; SPA `vercel.json` |
| **MO-12** | Failed logins are not logged — no security event stream to alert on | 🟡 Medium | Confirmed | `modules/auth/routes.ts:70-79` |
| **MO-13** | Webhook delivery failures swallowed by bare `catch {}` (no log / no Sentry) | 🟡 Medium | Confirmed | `services/webhooks.ts:52-57,71` |
| **MO-14** | TOCTOU idempotency: order ingest dedup & POD completion are read-then-write, not DB-enforced | 🟡 Medium | Confirmed | `services/orders.ts:23-28`; `modules/routes/routes.ts:453-457,518-543`; `schema.prisma` (no `@@unique([tenantId, externalRef])`) |
| **MO-15** | Public tracking JSON returns recipient PII + live driver GPS with no cache headers | 🟡 Medium | Confirmed | `modules/tracking/public.ts:52-168` |
| **MO-16** | JWT stored in `localStorage` across all SPAs (XSS-readable; admin token is highest value) | 🟡 Medium | Confirmed | `apps/web/src/api.ts:24-39`; `apps/driver/src/api.ts:4-10`; `apps/admin/src/api.ts:10-14` |
| **MO-17** | Driver logout does not purge on-device PII caches (route, offline queue, chargers) | 🟡 Medium | Confirmed | `apps/driver/src/App.tsx:628-631`; `apps/driver/src/api.ts:2,95` |
| **MO-18** | DISPATCHER (any staff) can read tenant billing/cost via non-ADMIN GET handlers | 🟡 Medium | Confirmed | `modules/controls/routes.ts:66-75,206-222` |
| **MO-19** | `@fastify/multipart` registered with no global limits (`files`/`parts`/`fields`) | 🟡 Medium | Confirmed | `app.ts:73` |
| **MO-20** | No `Cache-Control: no-store` on authenticated API JSON (back-button after logout) | 🔵 Low | Confirmed | `app.ts` (no default `Cache-Control`) |
| **MO-21** | Login user-enumeration via bcrypt timing side-channel (response body is uniform) | 🔵 Low | Likely | `modules/auth/routes.ts:66-72`; `modules/platform/auth.ts:13-18` |
| **MO-22** | Sentry/alerting off-by-default in prod (`SENTRY_DSN` empty in blueprint) | 🔵 Low | Confirmed | `lib/sentry.ts:8-21`; `render.yaml` |
| **MO-23** | Deleted/missing tenant (`status === null`) is not blocked — only `SUSPENDED` is | 🔵 Low | Confirmed | `plugins/tenantStatus.ts:22-25`; `plugins/auth.ts:42` |
| **MO-24** | POD upload MIME validated by client-declared type, not magic bytes | 🔵 Low | Confirmed | `modules/uploads/routes.ts:18-46`; `services/storage.ts:35-43` |
| **MO-25** | Prod SPA builds may ship JS source maps (no explicit `sourcemap:false`) | 🔵 Low | Likely | `apps/{web,admin,driver}/vite.config.ts` |
| **MO-26** | HSTS `max-age` is helmet's 180-day default (no preload) | 🔵 Low | Confirmed | `app.ts:62` |
| **MO-27** | Weak hardcoded **dev** JWT secret fallback (prod boot guard present & correct) | 🔵 Low | Confirmed | `config.ts:1-12` |
| **MO-28** | Demo seed credentials are public/documented (`moveos123`) | 🔵 Low | Confirmed | `apps/api/prisma/seed.ts:13-26` |
| **MO-29** | `weightKg` and similar operational numerics are client-trusted on order creation | 🔵 Low | Confirmed | `services/orders.ts`; `portalCreateOrderSchema` |
| **MO-30** | No explicit Fastify `bodyLimit` (relies on 1 MB default) | 🔵 Low | Confirmed | `app.ts:54-60` |
| **MO-31** | `<500` business errors echo `err.message` verbatim (no concrete leak found) | 🔵 Low | Confirmed | `app.ts:115-117` |
| **MO-32** | Dev-tooling CVEs (vitest/vite/esbuild) — not in the prod image | 🔵 Low | Confirmed | transitive under `vitest`/`vite` |
| **MO-33** | `.gitignore` lacks `*.pem`/`*.key`/`*.p12`/`.env.*.local` patterns (no such files today) | 🔵 Low | Confirmed | `.gitignore` |

---

## 3. Detailed findings

### 🔴 MO-01 — Vulnerable `fast-jwt` in the production JWT authentication path
- **Severity:** Critical · **Status:** Confirmed · **OWASP:** A03 Software Supply Chain Failures (+ A07 Auth)
- **Location:** `apps/api/package.json:22` (`@fastify/jwt ^9.0.1` → `9.1.0`) → `fast-jwt@5.0.6` (`pnpm-lock.yaml:1551`); consumed by `apps/api/src/plugins/auth.ts:8` — the auth backbone for **all** tenant and platform tokens.
- **Evidence:** `pnpm audit --prod` returns **6 advisories, all `fast-jwt`** (3 critical / 1 high / 2 moderate): a critical "empty HMAC secret accepted" JWT-bypass (fixed `>=6.2.4`), a critical "incomplete fix for CVE-2023-48223" RS256→HS256 algorithm-confusion (fixed `>=6.2.0`), a critical cache-confusion via `cacheKeyBuilder` collisions, a high `crit`-header bypass (CVE-2026-35042), plus 2 ReDoS moderates.
- **Exploitability here:** MoveOS uses a symmetric HS256 secret, so the RS256-confusion vector isn't directly reachable, but the **empty-HMAC-secret critical** is relevant if `JWT_SECRET` is ever empty/unset (Render auto-generates it, but a misconfigured/local prod deploy could leave it blank), and the `crit`-bypass is a token-validation weakness. A vulnerable JWT library on the critical path is a Critical regardless of the currently-reachable subset.
- **Remediation (verified real):** Bump `@fastify/jwt` to **`^10.1.0`** (confirmed latest via `pnpm outdated -r`), which pulls patched `fast-jwt >=6.2.4`; validate the v9→v10 major against `registerAuth`. Add a boot assertion in `config.ts` that `JWT_SECRET` is non-empty (defense even after patch). Re-run `pnpm audit --prod` to confirm 0 prod advisories.

### 🟠 MO-02 — SSRF via tenant-controlled outbound URLs (three sinks)
- **Severity:** High · **Status:** Confirmed · **OWASP:** A01 (SSRF, 2025)
- **Locations & evidence:**
  1. **Response-oracle SSRF** — `modules/clients/routes.ts:131-148`: `const { webhookUrl } = z.object({ webhookUrl: z.string().url() }).parse(...)` then `await fetch(webhookUrl, {method:"POST"})` and **returns `{ ok: res.ok, status: res.status }`** to the caller. Any authed ADMIN/DISPATCHER turns the server into a port/host scanner for the internal network and cloud metadata (`http://169.254.169.254/...`, `http://localhost:*`, `10/8`).
  2. **Stored SSRF (developer webhooks)** — registration `modules/developer/routes.ts:34-40` (schema `packages/shared/src/schemas.ts:260-264`, `url: z.string().url()`), delivered by `services/webhooks.ts:38` on every event and on-demand via `POST /developer/webhooks/:id/test`; `lastStatus` is persisted (oracle).
  3. **Stored SSRF (per-client notify channel)** — `Client.webhookUrl` (`schemas.ts:63`) fetched at `services/notifications.ts:87`; triggerable via `POST /clients/:id/test-notification`.
- **Common root cause:** `z.string().url()` accepts any scheme/host; no private-CIDR/metadata block, no scheme allowlist, no DNS-rebind protection, no redirect pinning.
- **Remediation (single fix):** Add a centralized `safeFetch()` used by all three sinks: restrict scheme to `http(s)`, resolve the host and reject loopback/private/link-local/CGNAT/metadata ranges (`127/8`,`10/8`,`172.16/12`,`192.168/16`,`169.254/16`,`::1`,`fc00::/7`), block `*.internal`, set `redirect:"error"`, and pin the resolved IP. Validate at write-time (Zod `.refine`) **and** delivery-time. HMAC signing does not mitigate SSRF.
- **MANUAL:** see §7 (do not run against prod).

### 🟠 MO-03 — POD delivery evidence (PII) served from a public bucket / unauthenticated `/files/`
- **Severity:** High · **Status:** Confirmed (config + code); live cacheability MANUAL · **OWASP:** A01 + A02
- **Evidence:** `services/storage.ts:82` returns the **public** object path `…/storage/v1/object/public/${bucket}/${key}`; `docs/DEPLOYMENT.md:27-28` documents bucket `pod-photos` as **"public read, service-role write."** POD photos are delivery evidence (premises, packages, sometimes recipients/signatures = PII and B2B dispute evidence). In dev, `app.ts:76-80` serves the same files via `@fastify/static` at `/files/` with **no auth preHandler** and **no `Cache-Control`**. Keys are `pod/<tenantId>/<24-hex>.jpg` — 96 bits of entropy, so not enumerable, but protection rests **entirely on URL secrecy**: any leak (logs, `Referer`, screenshot, a malicious webhook target, browser history) grants permanent, unauthenticated, cross-tenant access, and a public object is freely cacheable by any shared CDN with no revocation.
- **Remediation:** Make `pod-photos` **private**; return **short-TTL signed URLs** (`/object/sign/...`) with `Cache-Control: private, max-age=<short>`. Better: serve POD through an authenticated, tenant-scoped API endpoint that verifies `route.tenantId === req.user.tenantId` and streams the bytes. For the dev `/files/` route, add an auth hook + `Cache-Control: private, no-store`, or don't register it in any internet-exposed deployment (fail closed if `SUPABASE_*` is unset rather than silently serving local files).
- *(Merged from 4 agents: access-control AC2, cache CA1/CA2, config CF9.)*

### 🟠 MO-04 — Global rate limiter is per-instance in-memory and not proxy-aware
- **Severity:** High · **Status:** Confirmed (code); live behavior MANUAL · **OWASP:** A04 Insecure Design (anti-automation)
- **Evidence:** `app.ts:55-72` — `Fastify({...})` sets **no `trustProxy`**, and `@fastify/rate-limit` is `{ global:true, max:300, timeWindow:"1 minute" }` with **no Redis store and no `keyGenerator`** (default key = `request.ip`). Two consequences: (1) counters live in process memory, so any horizontal scale or restart on Render makes the effective limit `N × max` and resets it; (2) without `trustProxy`, `request.ip` is the Render edge's socket IP, not the client — collapsing many clients to one key (false lockouts) or making the real-client `X-Forwarded-For` invisible to the limiter. The per-route login/copilot caps inherit the same weakness.
- **Remediation:** Set `trustProxy: true` (or the exact hop count) so `request.ip` reflects `X-Forwarded-For`; back `@fastify/rate-limit` with the planned Redis store for a shared cross-instance counter; add a `keyGenerator` that factors tenant/API-key on authenticated routes.

### 🟠 MO-05 — Ingest order-creation endpoints have no per-route rate limit
- **Severity:** High · **Status:** Confirmed · **OWASP:** A04 Insecure Design / Abuse
- **Evidence:** `modules/ingest/routes.ts:38-77` — `POST /ingest/orders` and `POST /ingest/orders/:source` carry only `{ preHandler:[requireApiScope("orders:write")] }`, **no `config:{rateLimit}}`**. They call `createOrder` (DB writes + geocoding cascade + webhook fan-out). A leaked/abusive tenant API key can flood order creation up to the soft global 300/min (and per MO-04 that ceiling is unreliable). No per-key quota.
- **Remediation:** Add a tighter per-route `rateLimit` **keyed by API key** (not IP) on ingest; enforce a per-tenant/per-key daily order quota tied to the plan.

### 🟠 MO-06 — Tenant ADMIN can self-enable paid modules (paywall bypass)
- **Severity:** High (business) / Medium (security) · **Status:** Confirmed · **OWASP:** A01 (function-level / business-logic authz)
- **Evidence:** `modules/admin/modules.ts:31-89` — the **tenant-plane** `PATCH /modules/:key` does `prisma.moduleEntitlement.upsert(... enabled:true ...)` and only blocks `CORE_MODULE_KEYS`. Paid modules (`TELEMATICS`, `SAFETY`, `ANALYTICS_PRO`, `AI_ADDONS`, `CUSTOMER_EXPERIENCE_PRO`, `COMPLIANCE_RNDC`, `COLD_CHAIN`; all `core:false` in `packages/shared/src/modules.ts:57-125`) can be turned on by a customer admin with no billing/platform check. A parallel platform-admin override (`platform/tenants.ts:331`, behind `requirePlatformAdmin`) exists, which makes the tenant-plane self-grant look unintended.
- **Remediation:** Remove enable-side self-service from the tenant plane (let ADMIN only **disable**/downgrade, or only enable modules included in the tenant's plan via `planLimits`/catalog); route `enable` through the platform/billing plane.
- **MANUAL:** see §7 (AC-M1).

### 🟠 MO-07 — No SCA/audit gate in CI; no Dependabot
- **Severity:** High · **Status:** Confirmed · **OWASP:** A03 Supply Chain
- **Evidence:** `.github/workflows/ci.yml` does install → prisma generate → migrate → build → test, with **no `pnpm audit`/SCA/secret-scan**. No `.github/dependabot.yml` / `renovate.json`. This is precisely why MO-01's critical chain shipped unnoticed.
- **Remediation:** Add a CI step `pnpm audit --prod --audit-level=high` (fail on prod high/critical) and `.github/dependabot.yml` for the npm/pnpm ecosystem (weekly, grouped). Both are zero-cost.

### 🟡 MO-08 — Stateless JWT cannot be revoked
- **Severity:** Medium · **Status:** Confirmed · **OWASP:** A07
- **Evidence:** `plugins/auth.ts:8-11` signs `{ expiresIn:"12h" }` with no `tokenVersion`/`jti`. There is **no `/logout` endpoint** (frontend logout just clears `localStorage`, `apps/web/src/api.ts:31-39`), and `platform/users.ts` documents that password-reset/delete "no revoca los JWT ya emitidos (viven ≤12h)." A reset/deleted/role-changed user keeps a valid token for up to 12h. (Tenant *suspension* is re-checked live via `getTenantStatus` — good — but identity/role changes are not.)
- **Remediation:** Add a monotonic `tokenVersion` (or `passwordChangedAt`) claim stamped at sign time and compared in `verifyTenantToken`/`requirePlatformAdmin`; bumping it gives real logout. Or a short `jti` denylist with TTL = remaining exp.

### 🟡 MO-09 — Self-service tenant registration abuse surface
- **Severity:** Medium · **Status:** Confirmed · **OWASP:** A07 / A04
- **Evidence:** `modules/auth/routes.ts:14-56` — `/login` is throttled (10/min) but `/auth/register` has **no rate limit and no CAPTCHA**, creates a Tenant + entitlements + ADMIN user per call, and issues a working 12h ADMIN token with **no email verification** (`role` is correctly server-hardcoded to `ADMIN`, so this is *not* a privilege-escalation-into-existing-tenant bug — it's mass-signup abuse + unverified-email account creation).
- **Remediation:** Add a tight per-route limit (e.g. 5/min/IP) + CAPTCHA/Turnstile, and require email verification before issuing an operational token. Confirm against the go-live product decision.

### 🟡 MO-10 — Address `/validate` cost-amplification
- **Severity:** Medium · **Status:** Confirmed · **OWASP:** A04 / Abuse (cost)
- **Evidence:** `modules/addresses/routes.ts:63-70` — `POST /addresses/validate` → `geocodeAddress` runs the paid LUPAP/Google provider cascade with **only the soft global 300/min**. Novel strings bypass the Address-Graph cache, so an authed user can amplify paid-provider spend (financial DoS).
- **Remediation:** Per-tenant per-route `rateLimit`; meter paid-provider calls against plan usage.

### 🟡 MO-11 — SPAs have no committed hosting security headers
- **Severity:** Medium · **Status:** Likely (verify live) · **OWASP:** A02
- **Evidence:** helmet protects only API JSON. The clickjacking/CSP surface is the SPA HTML, served by Vercel/Cloudflare Pages. No `vercel.json` `headers` block / `_headers` file / CSP / `frame-ancestors` / `X-Frame-Options` exists for the SPA hosts in the repo; the three `vite.config.ts` set none.
- **Remediation:** Commit explicit host headers for each SPA: CSP with `frame-ancestors 'self'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, HSTS. Verify with `securityheaders.com` (§7).

### 🟡 MO-12 — Failed logins not logged
- **Severity:** Medium · **Status:** Confirmed · **OWASP:** A09 Logging & Alerting Failures
- **Evidence:** `modules/auth/routes.ts:70-79` returns 401 on bad credentials / unknown email / suspended tenant with **no `app.log` line and no audit record**. Credential-stuffing/lockout patterns are invisible to ops. (Rate-limit 10/min blunts brute force but provides nothing to alert on.)
- **Remediation:** `app.log.warn({ event:"auth.login_failed", email, ip })` (email only, never password) on each 401; optional per-account failed-attempt counter; feed Sentry/Render logs.

### 🟡 MO-13 — Webhook delivery failures swallowed silently
- **Severity:** Medium · **Status:** Confirmed · **OWASP:** A09
- **Evidence:** `services/webhooks.ts:52-57` catches failures with a bare `catch {}` recording only `lastStatus:0`, and `:71` discards `Promise.allSettled` results. No `app.log`/`captureError`. Developer integrations can silently stop receiving events with zero operator visibility.
- **Remediation:** Log a warn line with `webhook.id`/`tenantId`/`url`/status (no secret) on failure; `captureError` on repeated failures; surface `lastStatus` in the developer UI.

### 🟡 MO-14 — TOCTOU idempotency on order ingest & POD completion
- **Severity:** Medium · **Status:** Confirmed (structure); race frequency Likely · **OWASP:** A10 Mishandling of Exceptional Conditions
- **Evidence:** `services/orders.ts:23-28` dedups by `findFirst({where:{tenantId, externalRef}})` then inserts — a read-then-insert with **no `@@unique([tenantId, externalRef])`** in `schema.prisma` and no transaction; two concurrent retries (Shopify/Zapier deliver-on-timeout) both insert → duplicate orders. POD `modules/routes/routes.ts:453-457` checks `status==="COMPLETED"` then updates `routeStop` by `id` only (`:518-543`) with **no status precondition**; concurrent offline-queue replays can both pass and both emit DELIVERED webhooks/`OrderEvent`s.
- **Remediation:** Add `@@unique([tenantId, externalRef])` and upsert/catch P2002 in `createOrder`; make the POD update conditional (`updateMany where status != 'COMPLETED'`, check `count`) so a replay is a true no-op.

### 🟡 MO-15 — Public tracking JSON returns PII + live GPS with no cache headers
- **Severity:** Medium · **Status:** Confirmed · **OWASP:** A02
- **Evidence:** `modules/tracking/public.ts:52-168` returns `recipient`, `address`, `operator`, `sender`, and `driverPosition{lat,lng,at}` (FULL tier) with **no `Cache-Control`**. Token-keyed private data that should never be shared-cache-eligible. (The SSE stream path already sets `no-cache`.)
- **Remediation:** `reply.header('Cache-Control','no-store')` on `/track/:token` (and its 404 path).

### 🟡 MO-16 — JWT in `localStorage` across all SPAs
- **Severity:** Medium (High combined with any XSS) · **Status:** Confirmed · **OWASP:** A05 / A07
- **Evidence:** `apps/web/src/api.ts:24-39` (`moveos_token`), `apps/driver/src/api.ts:4-10` (`moveos_driver_token`), `apps/admin/src/api.ts:10-14` (`moveos_platform_token`). Any XSS exfiltrates a 12h bearer token; the **admin token grants cross-tenant platform access** — highest value. (This is also why CSRF is a non-issue, MO-info: header-bearer auth, no cookies.) *Positive:* the impersonation token correctly uses URL fragment + `sessionStorage`.
- **Remediation:** Prefer httpOnly+Secure+SameSite cookies (would then require CSRF tokens), or keep tokens short-lived + revocable (MO-08) behind a strict CSP. Keep `dangerouslySetInnerHTML` banned (lint rule).

### 🟡 MO-17 — Driver logout leaves PII in on-device storage
- **Severity:** Medium · **Status:** Confirmed · **OWASP:** A02 / A05
- **Evidence:** `apps/driver/src/App.tsx:628-631` logout runs only `setToken(null)`. The cached route `moveos_driver_route` (customer names/addresses), the offline queue `moveos_driver_queue` (`api.ts:2,95` — queued delivery POST bodies, POD URLs, addresses), and `moveos_driver_chargers` **persist** in `localStorage`. On a shared/handed-off driver device the next holder can read prior deliveries' PII via DevTools.
- **Remediation:** On logout, clear `moveos_driver_route`/`moveos_driver_queue`/`moveos_driver_chargers` (and `caches.delete()` for non-tile caches); warn if the offline queue is non-empty before discarding.

### 🟡 MO-18 — DISPATCHER can read tenant billing/cost
- **Severity:** Medium → treat as Low-Medium · **Status:** Confirmed · **OWASP:** A01 (function-level authz)
- **Evidence:** `modules/controls/routes.ts:66-75` (`GET /controls/cost`) and `:206-222` (`GET /controls/billing`) require only `app.authenticate` (any staff), while their `PATCH` counterparts require `ADMIN`. They return `driverCostPerHourCop`, `energyTariffCop`, `legalName/nit/billingEmail/billingAddress`, invoices. The web SPA hides the nav link but still mounts the route for DISPATCHER, so the data is reachable. Tenant isolation is intact — this is a **role-scoping** gap, not cross-tenant.
- **Remediation:** Add `requireRole("ADMIN")` to these two GET handlers if billing/cost is ADMIN-only.

### 🟡 MO-19 — `@fastify/multipart` has no global limits
- **Severity:** Medium · **Status:** Confirmed · **OWASP:** A05 / DoS
- **Evidence:** `app.ts:73` — `register(multipart)` with no `limits`. The only size cap is inside the POD handler (`uploads/routes.ts:22`, 8 MB `fileSize`). Field/part counts and any future multipart consumer are unbounded — a body with thousands of parts/huge fields is a resource-exhaustion vector.
- **Remediation:** `register(multipart, { limits: { fileSize: 8*1024*1024, files: 1, fields: 10, parts: 20 } })`, keeping per-route overrides.

### 🔵 Low findings (condensed)
- **MO-20** — No `Cache-Control: no-store` on authenticated API JSON (`app.ts`; only SSE sets `no-cache`). Bounded by Bearer-token auth (no ambient cookie) but defense-in-depth wants `no-store` given shared-device risk (MO-17). *Fix:* `onSend` hook setting `no-store` on non-public/non-asset routes.
- **MO-21** — Login timing user-enumeration: `bcrypt.compare` is short-circuited when the email is unknown (`auth/routes.ts:66-72`; same in `platform/auth.ts`), so existing emails pay ~tens of ms more. Response body is correctly uniform. *Fix:* always compare against a fixed dummy hash. *(Likely — confirm timing in deployment.)*
- **MO-22** — Sentry no-ops when `SENTRY_DSN` is unset and the Render blueprint ships it empty (`lib/sentry.ts:8-21`). On a fresh deploy all 5xx go to logs only. *Positive:* `captureError` sends only the exception, never request bodies/headers/tokens. *Fix:* make `SENTRY_DSN` a required go-live checklist item.
- **MO-23** — `getTenantStatus` returns `null` for a missing/deleted tenant (`tenantStatus.ts:22-25`) and the gate only blocks `status==="SUSPENDED"` (`auth.ts:42`), so a deleted tenant's outstanding tokens still authenticate. *Fix:* treat `status !== "ACTIVE"` (incl. `null`) as 403.
- **MO-24** — POD MIME is taken from the client-declared multipart `Content-Type`, not magic bytes (`uploads/routes.ts`; `storage.ts:35-43`). Impact limited (extension forced from allowlist + helmet `nosniff` + random server filename blocks traversal & SVG-XSS). *Fix:* verify magic bytes (`file-type`); ensure POD served as image/attachment, never `text/html`.
- **MO-25** — Vite `build.sourcemap` defaults to `false` but is not explicitly locked in the three configs. *Fix:* set `build:{ sourcemap:false }`; confirm no `*.map` in `dist/`. *(Likely.)*
- **MO-26** — HSTS is helmet's 180-day default, no preload (`app.ts:62`). *Fix (optional):* `helmet({ hsts:{ maxAge:31536000, includeSubDomains:true, preload:true } })`.
- **MO-27** — `config.ts:1-12` has a hardcoded `DEV_JWT_SECRET` fallback, but a correct prod boot guard throws if prod uses it or `<32` chars, and `render.yaml` auto-generates a strong secret. **No prod exposure; no rotation needed.** *Optional:* randomize the dev fallback.
- **MO-28** — Demo seed password `moveos123` is documented and bcrypt-hashed in `seed.ts:13-26` (test fixtures for `*.demo.moveos.co`). *Fix:* gate the seed behind `NODE_ENV !== "production"` / never run against the prod DB.
- **MO-29** — `weightKg` (and similar) are client-supplied and feed capacity/optimizer math; **no price is computed client-side** (price derives from server-validated `serviceId`), so this is trusted-input-affecting-planning, not price tampering. *Fix:* bound/validate against service constraints if weight ever drives billing.
- **MO-30** — No explicit `bodyLimit` (relies on Fastify's 1 MB default; `app.ts:54-60`). Malformed/empty JSON is handled cleanly (no crash). *Fix:* set an intentional `bodyLimit`.
- **MO-31** — `<500` errors return `err.message` verbatim (`app.ts:115-117`); all observed 4xx messages are deliberate Spanish business strings, **no concrete internal leak found**, but a future library error with a 4xx code would pass its message through. *Fix:* whitelist 4xx messages.
- **MO-32** — Dev-tooling CVEs (vitest `<3.2.6` arbitrary file read, vite `server.fs.deny` bypass, esbuild dev-server CORS). All require a running dev server / Vitest UI — **not in the Render prod image** (devDependencies). *Fix:* bump `vitest ^3.2.6`, resolve `vite >=6.4.3`.
- **MO-33** — `.gitignore` covers `.env`/`.env.local` but not `*.pem`/`*.key`/`*.p12`/`*.pfx`/`.env.*.local`. No such files exist today. *Fix:* add the patterns to prevent accidental future commits.

---

## 4. Prioritized "fix in this order"

1. **MO-01** — Bump `@fastify/jwt` to `^10` (patched `fast-jwt`) + assert non-empty `JWT_SECRET`. *(Critical, production auth path.)*
2. **MO-02** — Add a shared `safeFetch()` SSRF guard to the three webhook/notification sinks. *(One fix closes all three High SSRF findings.)*
3. **MO-03** — Make `pod-photos` private + signed URLs (or authenticated streaming endpoint); secure/no-store the dev `/files/` route. *(PII, cross-tenant, permanent.)*
4. **MO-07 + MO-32** — Add `pnpm audit --prod` CI gate + Dependabot; bump dev tooling. *(Prevents the next MO-01; cheap.)*
5. **MO-04 + MO-05 + MO-10 + MO-09** — Rate-limiting hardening: `trustProxy`, shared store, per-route caps on ingest/validate/register, CAPTCHA + email-verify on register.
6. **MO-06 + MO-18 + MO-23** — Authorization tightening: stop tenant self-enable of paid modules; `requireRole("ADMIN")` on billing/cost GETs; block `null`/non-ACTIVE tenant status.
7. **MO-08 + MO-16 + MO-17** — Session hardening: token revocation/`tokenVersion`, reconsider `localStorage` vs httpOnly, purge driver PII on logout.
8. **MO-14 + MO-19** — Robustness: DB-enforced idempotency (`@@unique`, conditional updates) + global multipart limits.
9. **MO-12 + MO-13 + MO-22** — Observability: log failed logins & webhook failures; require `SENTRY_DSN` for go-live.
10. **MO-11 + MO-15 + MO-20 + remaining Lows** — Headers/caching hygiene: SPA security headers, `no-store` on tracking + authed JSON, source-map lockdown, `.gitignore` patterns.

---

## 5. Coverage & checks that could not be fully assessed

All 24 spec checks were addressed. Items requiring runtime/console access (out of static-analysis scope), recorded so they aren't assumed clean:
- **Live header/CORS/cache behavior** (checks 9, 10, 18, 19, 22) — code is authoritative for what's *sent*; the edge (Render/Vercel/Cloudflare) may add/override headers. Verify via §7.
- **Whether the production Supabase `pod-photos` bucket is actually public** and whether `service_role`/provider keys are correctly entered as Render secrets — repo says public (MO-03); confirm in the Supabase/Render dashboards.
- **JWT expiry & HS256 pinning at runtime** — enforced by `@fastify/jwt` defaults; no `ignoreExpiration` set. Optional belt-and-suspenders: pin `verify:{ algorithms:["HS256"] }`.
- **Login timing delta** (MO-21) — measure in deployment.
- **Idempotency race frequency** (MO-14) — confirmed by code structure; not demonstrated with concurrent requests.

---

## 6. Items reviewed and found SOUND (no action)

Recorded so a clean result is on the record (Info):
- **Secrets:** no hardcoded provider keys (all `process.env` at use-site); no server secret in any `VITE_` client bundle; **git history clean** (pickaxe `-S` scans for PRIVATE KEY/sk-ant/AKIA/eyJ → none); tenant API keys stored as SHA-256, webhook secrets as HMAC, shown once.
- **Injection:** all `$queryRaw` is tagged-template parameterized; no `$queryRawUnsafe`/`Prisma.raw`/string-SQL; no `eval`/`Function`/`child_process`; all `orderBy` use static field names (no Prisma field-injection).
- **XSS:** zero `dangerouslySetInnerHTML`/`innerHTML`/`document.write` across all three SPAs; React default escaping on the public tracking page; no markdown/HTML renderer.
- **CSRF:** N/A — Bearer-header auth, no cookies anywhere (no `@fastify/cookie`).
- **Tenant isolation / IDOR:** every inspected `update/delete`-by-id is preceded by a tenant-scoped `findFirst` → 404; bare `findUnique({where:{id}})` cases are token-derived (public tracking) or platform-admin-by-design; `findUnique({where:{email}})` are global uniqueness collision checks only.
- **Platform plane:** `requirePlatformAdmin` rejects tenant tokens (403); impersonation is 30-min, audited, never CLIENT, tenant-scoped.
- **Auth provenance:** `tenantId`/`role`/`driverId`/`clientId` read only from verified JWT claims; signup hardcodes `ADMIN`, portal hardcodes `CLIENT`; no body-controlled role/tenant.
- **Supply chain:** no hallucinated/typosquatted packages; lockfile committed.
- **Logging:** no secrets/PII logged; platform audit redacts passwords; Sentry sends only exceptions.
- **Cache:** driver service worker caches only `/assets/`, shell, and OSM tiles — **API/`/uploads` explicitly bypass the SW cache**; no cache poisoning (no `X-Forwarded-Host` reflection); no `Set-Cookie`/token in a cacheable response; web cache deception N/A (JSON API + SPA-fallback to a no-secrets `index.html`).
- **Password reset:** admin-mediated only (no self-service token to attack); aligns with B2B-only Constraint 2.

---

## 7. Appendix — tools, commands, and MANUAL tests

### Tools
- **Available & used:** ripgrep/grep, git (pickaxe `-S` history scans), `pnpm audit` (`--prod`, `--json`), `pnpm outdated -r`, file reads.
- **Missing (recommended to add to CI):** `gitleaks`/`trufflehog` (continuous secret scanning), `semgrep` (`semgrep --config auto apps packages` for injection/XSS regressions). Dependency scanning + Dependabot (MO-07).

### Commands run (read-only)
`pnpm audit` → 12 advisories (4C/2H/5M/1L). `pnpm audit --prod` → 6, all `fast-jwt` (3C/1H/2M). `pnpm outdated -r` → `@fastify/jwt 9.1.0→10.1.0`, `@prisma/client 6.19.3→7.8.0`, etc. `git ls-files | grep lock` → `pnpm-lock.yaml` committed. No files modified, no packages installed, no app run, no prod requests.

### MANUAL live-probe procedures — **run only against a non-production/staging URL with authorization**
```bash
# AC-M1  MO-06 paywall: tenant ADMIN self-enables a paid module (expect 200 = bug)
curl -i -X PATCH https://STAGING/modules/AI_ADDONS -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' -d '{"enabled":true}'

# AC-M2  MO-02 SSRF oracle (expect the response to reflect internal reachability)
curl -i -X POST https://STAGING/clients/test-webhook -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' -d '{"webhookUrl":"http://169.254.169.254/latest/meta-data/"}'
# stored variants: POST /developer/webhooks {"url":"http://localhost:5432","events":["DELIVERED"]} then .../test
#                  PATCH /clients/:id {"notifyChannel":"WEBHOOK","webhookUrl":"http://localhost:3000/health"} then /test-notification

# AC-M3  MO-03 POD evidence without auth (expect the image bytes = exposure)
curl -i "https://STAGING/files/pod/<tenantId>/<key>.jpg"
curl -sI "https://<project>.supabase.co/storage/v1/object/public/pod-photos/<key>.jpg"   # check public + Cache-Control

# AC-M4  Cross-tenant IDOR (expect 404 = isolation holds)
curl -i https://STAGING/orders/$ID_OF_TENANT_B -H "Authorization: Bearer $TOKEN_TENANT_A"
curl -i https://STAGING/platform/tenants     -H "Authorization: Bearer $TENANT_TOKEN"    # expect 403

# AC-M5  Headers / CORS / rate-limit (read-only)
curl -sSI https://STAGING/health | grep -iE 'strict-transport|content-security|x-content-type|x-frame|referrer-policy'
curl -sSI -H 'Origin: https://evil.com' https://STAGING/auth/me | grep -i 'access-control-'   # expect no reflection
for U in https://app... https://admin... https://conductor...; do curl -sSI "$U" | grep -iE 'content-security|x-frame'; done
# Login throttle (staging only): burst 100x POST /auth/login with wrong creds → expect 429 after ~10; repeat from 2nd IP to test MO-04 per-instance weakness.

# MO-16/MO-17 on-device (DevTools → Application): confirm JWT + PII in Local Storage; after "Salir", confirm
#   moveos_driver_route / moveos_driver_queue / moveos_driver_chargers PERSIST (bug); Cache Storage holds no /orders|/auth.
```

---

*End of report. No fixes have been applied. I can remediate any finding on request — recommended starting order is §4 (MO-01 → MO-02 → MO-03).*
