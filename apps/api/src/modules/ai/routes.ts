import type { FastifyInstance, FastifyReply } from "fastify";
import {
  aiActionApplySchema,
  aiActionRunSchema,
  type ActionContext,
  type ActionRole,
} from "@moveos/shared";
import { requireRole } from "../../plugins/auth.js";
import { isModuleEnabled, requireModule } from "../../plugins/entitlements.js";
import { actionCatalog, getAction } from "./registry.js";
import { AiActionError, applyProposal, runAction } from "./executor.js";

/**
 * Capa de optimización con IA. Un solo registro alimenta los botones
 * "Optimizar con IA" y (más adelante) el Copiloto, con UNA ruta de aplicación
 * auditada. Gating: AI_ADDONS en todas; módulo extra por acción (p. ej.
 * COLD_CHAIN) cuando aplique. El rol del autor manda: la IA nunca hace lo que el
 * usuario no podría.
 */
export default async function aiRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.addHook("preHandler", requireModule("AI_ADDONS"));

  function sendError(reply: FastifyReply, err: unknown) {
    if (err instanceof AiActionError) {
      return reply.code(err.statusCode).send({ error: err.message, code: err.code });
    }
    throw err;
  }

  /** Catálogo que el rol/tenant puede ver — define qué botones se pintan. */
  app.get(
    "/actions",
    { preHandler: [requireRole("ADMIN", "DISPATCHER")] },
    async (request) => {
      const role = request.user.role as ActionRole;
      const tenantId = request.user.tenantId;
      const visible = [];
      for (const entry of actionCatalog()) {
        if (!entry.roles.includes(role)) continue;
        // Módulo extra por acción (AI_ADDONS ya está garantizado por el hook).
        if (
          entry.module &&
          entry.module !== "AI_ADDONS" &&
          !(await isModuleEnabled(tenantId, entry.module))
        ) {
          continue;
        }
        visible.push(entry);
      }
      return { actions: visible };
    },
  );

  /** Ejecuta en seco y devuelve una propuesta (no aplica). */
  app.post(
    "/actions/:id/run",
    {
      preHandler: [requireRole("ADMIN", "DISPATCHER")],
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const action = getAction(id);
      if (!action) {
        return reply.code(404).send({ error: "Acción desconocida", code: "UNKNOWN_ACTION" });
      }
      // Gating de módulo específico de la acción.
      if (
        action.meta.module &&
        action.meta.module !== "AI_ADDONS" &&
        !(await isModuleEnabled(request.user.tenantId, action.meta.module))
      ) {
        return reply.code(403).send({
          error: `Módulo no activo: ${action.meta.module}`,
          code: "MODULE_NOT_ENABLED",
          moduleKey: action.meta.module,
        });
      }

      const body = aiActionRunSchema.parse(request.body ?? {});
      const ctx: ActionContext = {
        tenantId: request.user.tenantId,
        userId: request.user.sub,
        role: request.user.role as ActionRole,
        ...body,
      };
      try {
        const proposal = await runAction(id, ctx);
        return reply.send(proposal);
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  /** Aplica una propuesta previamente generada (confirmación → persistencia). */
  app.post(
    "/actions/:id/apply",
    { preHandler: [requireRole("ADMIN", "DISPATCHER")] },
    async (request, reply) => {
      const { proposalId } = aiActionApplySchema.parse(request.body);
      try {
        const result = await applyProposal(proposalId, {
          tenantId: request.user.tenantId,
          userId: request.user.sub,
          role: request.user.role as ActionRole,
        });
        return reply.send(result);
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );
}
