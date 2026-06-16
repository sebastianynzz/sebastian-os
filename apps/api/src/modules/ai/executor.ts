import {
  DEFAULT_PROPOSAL_TTL_MS,
  type ActionContext,
  type ApplyResult,
  type Proposal,
} from "@moveos/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { getAction } from "./registry.js";
import { explainProposal } from "./explain.js";

/** Error con código HTTP para mapear en el handler. */
export class AiActionError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

/**
 * Ejecuta una acción en seco (run): arma entrada, resuelve (determinista),
 * narra (LLM o plantilla) y PERSISTE la propuesta pendiente. NO muta el dominio.
 */
export async function runAction(
  actionId: string,
  ctx: ActionContext,
): Promise<Proposal> {
  const action = getAction(actionId);
  if (!action) throw new AiActionError(404, `Acción desconocida: ${actionId}`, "UNKNOWN_ACTION");
  if (!action.meta.roles.includes(ctx.role)) {
    throw new AiActionError(403, "Tu rol no puede ejecutar esta acción", "ROLE_FORBIDDEN");
  }

  const input = await action.gatherInput(ctx);
  const solved = await action.solve(input, ctx);
  const fallback = action.summarize(solved);
  const summaryEs = await explainProposal(action.meta.id, fallback, solved.impact);
  const expiresAt = new Date(Date.now() + DEFAULT_PROPOSAL_TTL_MS);

  const row = await prisma.aiProposal.create({
    data: {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      actionId: action.meta.id,
      scope: action.meta.scope,
      summaryEs,
      changeJson: solved.change as Prisma.InputJsonValue,
      impactJson: solved.impact as unknown as Prisma.InputJsonValue,
      contextJson: ctx as unknown as Prisma.InputJsonValue,
      mutates: action.meta.mutates,
      feasible: solved.feasible,
      expiresAt,
    },
  });

  return {
    actionId: action.meta.id,
    proposalId: row.id,
    summaryEs,
    change: solved.change,
    impact: solved.impact,
    mutates: action.meta.mutates,
    feasible: solved.feasible,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Aplica (persiste) una propuesta tras la confirmación. Una sola ruta de
 * aplicación: la usan los botones de IA y (más adelante) el Copiloto. Idempotente
 * por reclamo atómico PENDING→APPLIED; 410 si expiró; 409 si ya se aplicó/cambió.
 */
export async function applyProposal(
  proposalId: string,
  user: { tenantId: string; userId: string; role: "ADMIN" | "DISPATCHER" },
): Promise<ApplyResult> {
  const row = await prisma.aiProposal.findFirst({
    where: { id: proposalId, tenantId: user.tenantId },
  });
  if (!row) throw new AiActionError(404, "Propuesta no encontrada", "PROPOSAL_NOT_FOUND");
  if (row.status === "APPLIED")
    throw new AiActionError(409, "La propuesta ya fue aplicada", "ALREADY_APPLIED");
  if (row.status === "DISCARDED")
    throw new AiActionError(409, "La propuesta fue descartada", "DISCARDED");
  if (row.expiresAt.getTime() < Date.now())
    throw new AiActionError(410, "La propuesta expiró; vuelve a generarla", "PROPOSAL_EXPIRED");
  if (!row.mutates)
    throw new AiActionError(400, "Acción asesora: no se aplica", "ADVISORY_ONLY");
  if (!row.feasible)
    throw new AiActionError(422, "La propuesta no es factible", "INFEASIBLE");

  const action = getAction(row.actionId);
  if (!action) throw new AiActionError(404, "Acción desconocida", "UNKNOWN_ACTION");
  if (!action.meta.roles.includes(user.role)) {
    throw new AiActionError(403, "Tu rol no puede aplicar esta acción", "ROLE_FORBIDDEN");
  }

  // Reclamo atómico: solo una solicitud transiciona PENDING→APPLIED.
  const claim = await prisma.aiProposal.updateMany({
    where: { id: row.id, status: "PENDING" },
    data: { status: "APPLIED", appliedAt: new Date(), appliedByUserId: user.userId },
  });
  if (claim.count === 0) {
    throw new AiActionError(409, "La propuesta ya fue aplicada", "ALREADY_APPLIED");
  }

  const ctx = row.contextJson as unknown as ActionContext;
  try {
    const { resultEs, data } = await action.apply(ctx, row.changeJson);
    const applied = await prisma.aiProposal.findUniqueOrThrow({ where: { id: row.id } });
    return {
      ok: true,
      proposalId: row.id,
      actionId: row.actionId as ApplyResult["actionId"],
      summaryEs: row.summaryEs,
      appliedAt: (applied.appliedAt ?? new Date()).toISOString(),
      resultEs,
      data,
    };
  } catch (err) {
    // Falló la aplicación: libera el reclamo para permitir reintento.
    await prisma.aiProposal.update({
      where: { id: row.id },
      data: { status: "PENDING", appliedAt: null, appliedByUserId: null },
    });
    if (err instanceof AiActionError) throw err;
    throw new AiActionError(
      500,
      err instanceof Error ? err.message : "Error al aplicar la propuesta",
      "APPLY_FAILED",
    );
  }
}
