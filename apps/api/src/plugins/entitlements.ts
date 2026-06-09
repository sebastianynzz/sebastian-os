import type { FastifyReply, FastifyRequest } from "fastify";
import type { ModuleKey } from "@moveos/shared";
import { prisma } from "../lib/prisma.js";

/**
 * preHandler que verifica que el tenant tenga el módulo activo.
 * Es el mecanismo central del modelo "core + módulos activables":
 * cada módulo de pago se registra detrás de esta verificación.
 */
export async function isModuleEnabled(
  tenantId: string,
  moduleKey: ModuleKey,
): Promise<boolean> {
  const entitlement = await prisma.moduleEntitlement.findUnique({
    where: { tenantId_moduleKey: { tenantId, moduleKey } },
  });
  return entitlement?.enabled ?? false;
}

export function requireModule(moduleKey: ModuleKey) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
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
