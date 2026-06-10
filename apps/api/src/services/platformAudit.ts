import type { FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

/**
 * Bitácora del plano de plataforma: toda mutación del operador MOVE queda
 * registrada (quién, qué, sobre qué tenant/usuario, con detalle JSON).
 *
 * Checklist para PRs: cualquier endpoint nuevo de /platform que mute estado
 * debe llamar a `auditPlatform`. Nunca incluir contraseñas en `details`.
 */

export type PlatformAuditAction =
  | "TENANT_PROVISION"
  | "TENANT_UPDATE"
  | "MODULE_TOGGLE"
  | "VEHICLE_ASSIGN"
  | "USER_CREATE"
  | "USER_UPDATE"
  | "USER_RESET_PASSWORD"
  | "USER_DELETE";

export async function auditPlatform(
  request: FastifyRequest,
  action: PlatformAuditAction,
  opts: {
    targetTenantId?: string;
    targetUserId?: string;
    details?: Prisma.InputJsonValue;
  } = {},
): Promise<void> {
  const admin = request.platformAdmin;
  if (!admin) return; // solo aplica detrás de requirePlatformAdmin
  await prisma.platformAuditLog.create({
    data: {
      adminId: admin.sub,
      adminEmail: admin.email,
      action,
      targetTenantId: opts.targetTenantId,
      targetUserId: opts.targetUserId,
      details: opts.details ?? {},
    },
  });
}

type JsonScalar = string | number | boolean | null;

/** Diff superficial antes/después para `details` (solo campos que cambiaron). */
export function shallowDiff(
  before: Record<string, JsonScalar | undefined>,
  after: Record<string, JsonScalar | undefined>,
): Record<string, { antes: JsonScalar; despues: JsonScalar }> {
  const diff: Record<string, { antes: JsonScalar; despues: JsonScalar }> = {};
  for (const key of Object.keys(after)) {
    const next = after[key];
    if (next !== undefined && next !== before[key]) {
      diff[key] = { antes: before[key] ?? null, despues: next };
    }
  }
  return diff;
}
