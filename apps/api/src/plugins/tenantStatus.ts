import { prisma } from "../lib/prisma.js";

/**
 * Caché TTL del estado de cada tenant (ACTIVE/SUSPENDED). La suspensión debe
 * surtir efecto casi de inmediato sin meter el estado en el JWT (que vive 12 h)
 * ni hacer una consulta extra en cada request. El panel de plataforma llama a
 * `invalidateTenantStatus` al cambiar el estado, así que en un solo proceso la
 * suspensión es inmediata; entre instancias es, a lo sumo, TTL-stale.
 */

const TTL_MS = 60_000;
const cache = new Map<string, { status: string; expiresAt: number }>();

export async function getTenantStatus(tenantId: string): Promise<string | null> {
  const hit = cache.get(tenantId);
  if (hit && hit.expiresAt > Date.now()) return hit.status;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { status: true },
  });
  if (!tenant) {
    cache.delete(tenantId);
    return null;
  }
  cache.set(tenantId, { status: tenant.status, expiresAt: Date.now() + TTL_MS });
  return tenant.status;
}

export function invalidateTenantStatus(tenantId: string): void {
  cache.delete(tenantId);
}
