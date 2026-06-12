---
name: moveos-copilot
description: Use when extending or debugging the MoveOS Copilot (modules/copilot) — adding tools, changing the model call, or wiring new confirmable actions into the dashboard chat panel.
---

# MoveOS Copilot — extension guide

The Copilot (`apps/api/src/modules/copilot/routes.ts`, gated by
`AI_ADDONS`, staff-only, rate-limited 20/min) is a thin Claude layer over
systems that already exist. It narrates; it does not own intelligence.

## Invariants — do not break

1. **Confirm-before-acting guard is structural, not prompt-based.**
   Tools that read execute server-side (`runReadTool`). Tools that would
   mutate are `proponer_*`: they only VALIDATE refs against the tenant and
   return a `CopilotAction {kind, summary, params}`. The web panel
   (`apps/web/src/pages/Copilot.tsx`) renders each action as a card whose
   Confirm button calls the real existing endpoint. The model can never
   execute a mutation, even if prompted to.
2. **Model call**: official `@anthropic-ai/sdk`, model `claude-opus-4-8`
   (override via `COPILOT_MODEL`), `thinking: {type: "adaptive"}`, manual
   tool loop (max 8 iterations) appending full `response.content` back as
   the assistant turn. Handle `stop_reason === "refusal"` and
   `Anthropic.APIError` (→ 502 `COPILOT_UPSTREAM_ERROR`). Missing
   `ANTHROPIC_API_KEY` → 503 `COPILOT_NOT_CONFIGURED` (the web panel
   explains this state).
3. **Spanish always** — system prompt and tool descriptions are Spanish and
   operational; cite optimizer exclusion reasons verbatim; never invent
   guías/placas/cifras (the prompt enforces, tools provide ground truth).
4. **Tenant scoping**: every tool handler takes `tenantId` from the JWT and
   scopes every Prisma query. A new tool that forgets this is a data leak.

## Adding a read tool

Add an `Anthropic.Tool` entry to `TOOLS` (Spanish description that says
WHEN to call it — prescriptive trigger conditions measurably improve
tool selection) and a case in `runReadTool`. Return compact JSON
(select only needed fields, cap list sizes ≤100).

## Adding a confirmable mutation

1. Add `proponer_<x>` tool + case in `buildProposal` that validates refs
   (tenant-scoped) and returns `{action, result:{propuesta_registrada:true}}`.
2. Add the `kind` to `CopilotAction` (API and web page copies).
3. In `Copilot.tsx` `confirm()`, map the kind to the real endpoint call and
   a Spanish success note.

## Day-one scenarios it must keep passing

morning planning ("planea los pedidos de hoy…" → proponer_plan),
"¿por qué no se entregó MV-…?" (consultar_pedido → bitácora/POD/geofence),
mid-day exception (listar_excepciones → proponer_insercion/recuperación),
flywheel health ("¿cuántas direcciones aprendió…?" →
estadisticas_grafo_direcciones).
