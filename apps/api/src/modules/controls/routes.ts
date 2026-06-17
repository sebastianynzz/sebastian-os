import type { FastifyInstance } from "fastify";
import {
  defaultPodPolicyConfig,
  podPolicyConfigSchema,
  type PodPolicyConfig,
} from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../../plugins/auth.js";

/**
 * Controles del tenant. Por ahora: política de prueba de entrega (POD)
 * configurable por tipo de parada (D2). Núcleo (sin gating de módulo): toda
 * operación necesita reglas de evidencia. Sin pagos → sin sección COD.
 */
export default async function controlsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  /** Devuelve la política POD por defecto del tenant (o la base sensata). */
  app.get("/pod-policy", async (request) => {
    const tenantId = request.user.tenantId;
    const row = await prisma.podPolicy.findUnique({
      where: { tenantId_scope: { tenantId, scope: "TEAM_DEFAULT" } },
    });
    const config = (row?.config as PodPolicyConfig | undefined) ?? defaultPodPolicyConfig();
    return { scope: "TEAM_DEFAULT", config };
  });

  /** Actualiza la política POD del tenant (solo ADMIN). */
  app.patch(
    "/pod-policy",
    { preHandler: [requireRole("ADMIN")] },
    async (request, reply) => {
      const tenantId = request.user.tenantId;
      const parsed = podPolicyConfigSchema.safeParse(
        (request.body as { config?: unknown } | undefined)?.config,
      );
      if (!parsed.success) {
        return reply.code(400).send({ error: "Configuración POD inválida" });
      }
      const config = parsed.data as PodPolicyConfig;
      const row = await prisma.podPolicy.upsert({
        where: { tenantId_scope: { tenantId, scope: "TEAM_DEFAULT" } },
        create: { tenantId, scope: "TEAM_DEFAULT", config },
        update: { config },
      });
      return { scope: "TEAM_DEFAULT", config: row.config };
    },
  );
}
