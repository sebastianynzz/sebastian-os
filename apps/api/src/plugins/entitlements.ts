import type { FastifyReply, FastifyRequest } from "fastify";
import { CORE_MODULE_KEYS, type ModuleKey } from "@moveos/shared";
import { prisma } from "../lib/prisma.js";

/**
 * preHandler que verifica que el tenant tenga el módulo activo.
 * Es el mecanismo central del modelo "core + módulos activables":
 * cada módulo de pago se registra detrás de esta verificación.
 *
 * Los módulos de NÚCLEO (CORE_MODULE_KEYS, p. ej. EV_MANAGEMENT) están
 * siempre activos sin importar el entitlement: MoveOS es EV-only y la
 * autonomía/carga no se venden como módulo (restricción dura 1.3).
 */
export async function isModuleEnabled(
  tenantId: string,
  moduleKey: ModuleKey,
): Promise<boolean> {
  if (CORE_MODULE_KEYS.has(moduleKey)) return true;
  const entitlement = await prisma.moduleEntitlement.findUnique({
    where: { tenantId_moduleKey: { tenantId, moduleKey } },
  });
  return entitlement?.enabled ?? false;
}

export function requireModule(moduleKey: ModuleKey) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (CORE_MODULE_KEYS.has(moduleKey)) return;
    const entitlement = await prisma.moduleEntitlement.findUnique({
      where: {
        tenantId_moduleKey: {
          tenantId: request.user.tenantId,
          moduleKey,
        },
      },
    });
    if (!entitlement?.enabled) {
      return reply.code(403).send({
        error: `Módulo no activo: ${moduleKey}`,
        code: "MODULE_NOT_ENABLED",
        moduleKey,
      });
    }
  };
}
