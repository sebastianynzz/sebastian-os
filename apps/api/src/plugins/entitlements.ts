import type { FastifyReply, FastifyRequest } from "fastify";
import { CORE_MODULE_KEYS, type ModuleKey } from "@moveos/shared";
import { prisma } from "../lib/prisma.js";

/**
 * preHandler que verifica que el tenant tenga el módulo activo.
 * Es el mecanismo central del modelo "core + módulos activables":
 * cada módulo de pago se registra detrás de esta verificación.
 *
 * Los módulos de NÚCLEO (CORE_MODULE_KEYS, p. ej. EV_MANAGEMENT) están
 * siempre activos sin importar el entitlement: daleGo es EV-only y la
 * autonomía/carga no se venden como módulo (restricción dura 1.3).
 *
 * Caché TTL por tenant (mismo patrón que plugins/tenantStatus.ts): sin ella
 * cada ping GPS pagaba dos consultas de entitlements — `requireModule` como
 * preHandler y `isModuleEnabled` para SAFETY dentro del handler — con una
 * flota reportando cada 30 s. Se cachea el mapa COMPLETO del tenant, así que
 * una sola consulta responde a todas las claves.
 *
 * La clave lleva SIEMPRE tenantId (restricción dura 3). El TTL es la red de
 * seguridad, no el mecanismo: los despliegues sin downtime de Render corren
 * dos contenedores a la vez, y el seed y el SQL manual no invalidan nada.
 */

const TTL_MS = 60_000;
const cache = new Map<string, { modules: Map<string, boolean>; expiresAt: number }>();

async function getModules(tenantId: string): Promise<Map<string, boolean>> {
  const hit = cache.get(tenantId);
  if (hit && hit.expiresAt > Date.now()) return hit.modules;

  const rows = await prisma.moduleEntitlement.findMany({
    where: { tenantId },
    select: { moduleKey: true, enabled: true },
  });
  const modules = new Map(rows.map((r) => [r.moduleKey, r.enabled]));
  cache.set(tenantId, { modules, expiresAt: Date.now() + TTL_MS });
  return modules;
}

export async function isModuleEnabled(
  tenantId: string,
  moduleKey: ModuleKey,
): Promise<boolean> {
  if (CORE_MODULE_KEYS.has(moduleKey)) return true;
  const modules = await getModules(tenantId);
  return modules.get(moduleKey) ?? false;
}

export function requireModule(moduleKey: ModuleKey) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (CORE_MODULE_KEYS.has(moduleKey)) return;
    const modules = await getModules(request.user.tenantId);
    if (!modules.get(moduleKey)) {
      return reply.code(403).send({
        error: `Módulo no activo: ${moduleKey}`,
        code: "MODULE_NOT_ENABLED",
        moduleKey,
      });
    }
  };
}

/**
 * Invalida el caché de un tenant. Llamar SIEMPRE justo después de escribir
 * ModuleEntitlement y antes de responder, para que activar o desactivar un
 * módulo surta efecto de inmediato en el mismo proceso.
 */
export function invalidateModuleEntitlements(tenantId: string): void {
  cache.delete(tenantId);
}

/** Solo para pruebas: vacía el caché tras escribir entitlements con Prisma. */
export function resetModuleEntitlementCache(): void {
  cache.clear();
}
