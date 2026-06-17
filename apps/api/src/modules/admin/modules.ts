import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  CORE_MODULE_KEYS,
  MODULE_CATALOG,
  MODULE_KEYS,
  modulesBlockingDisable,
  modulesToEnableWith,
  moduleName,
  type ModuleKey,
} from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../../plugins/auth.js";

/** Administración de módulos del tenant: el corazón del modelo activable. */
export default async function modulesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request) => {
    const entitlements = await prisma.moduleEntitlement.findMany({
      where: { tenantId: request.user.tenantId },
    });
    const byKey = new Map(entitlements.map((e) => [e.moduleKey, e.enabled]));
    return MODULE_CATALOG.map((m) => ({
      ...m,
      // Núcleo: siempre activo, sin importar lo que diga el entitlement.
      enabled: m.core === true || (byKey.get(m.key) ?? false),
    }));
  });

  app.patch(
    "/:key",
    { preHandler: [requireRole("ADMIN")] },
    async (request, reply) => {
      const params = z
        .object({ key: z.enum(MODULE_KEYS) })
        .parse(request.params);
      const body = z.object({ enabled: z.boolean() }).parse(request.body);
      const tenantId = request.user.tenantId;
      if (CORE_MODULE_KEYS.has(params.key)) {
        return reply.code(400).send({
          error: "Este módulo es parte del núcleo y no puede desactivarse",
          code: "CORE_MODULE",
          moduleKey: params.key,
        });
      }

      if (body.enabled) {
        // Habilitar arrastra sus dependencias (cascada): se prenden key + deps.
        const toEnable = modulesToEnableWith(params.key);
        await prisma.$transaction(
          toEnable.map((moduleKey) =>
            prisma.moduleEntitlement.upsert({
              where: { tenantId_moduleKey: { tenantId, moduleKey } },
              create: { tenantId, moduleKey, enabled: true },
              update: { enabled: true },
            }),
          ),
        );
        return reply.send({ enabled: toEnable });
      }

      // Desactivar: bloquear si un módulo habilitado depende de este.
      const enabled = await prisma.moduleEntitlement.findMany({
        where: { tenantId, enabled: true },
      });
      const enabledKeys: ModuleKey[] = [
        ...CORE_MODULE_KEYS,
        ...enabled.map((e) => e.moduleKey as ModuleKey),
      ];
      const blockers = modulesBlockingDisable(params.key, enabledKeys);
      if (blockers.length > 0) {
        return reply.code(409).send({
          error: `No se puede desactivar: ${blockers.map(moduleName).join(", ")} ${
            blockers.length > 1 ? "dependen" : "depende"
          } de este módulo. Desactívalo(s) primero.`,
          code: "MODULE_DEPENDENCY",
          moduleKey: params.key,
          blockedBy: blockers,
        });
      }
      const entitlement = await prisma.moduleEntitlement.upsert({
        where: { tenantId_moduleKey: { tenantId, moduleKey: params.key } },
        create: { tenantId, moduleKey: params.key, enabled: false },
        update: { enabled: false },
      });
      return reply.send(entitlement);
    },
  );
}
