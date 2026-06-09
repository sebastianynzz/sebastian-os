import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MODULE_CATALOG, MODULE_KEYS } from "@moveos/shared";
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
      enabled: byKey.get(m.key) ?? false,
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

      const entitlement = await prisma.moduleEntitlement.upsert({
        where: {
          tenantId_moduleKey: {
            tenantId: request.user.tenantId,
            moduleKey: params.key,
          },
        },
        create: {
          tenantId: request.user.tenantId,
          moduleKey: params.key,
          enabled: body.enabled,
        },
        update: { enabled: body.enabled },
      });
      return reply.send(entitlement);
    },
  );
}
