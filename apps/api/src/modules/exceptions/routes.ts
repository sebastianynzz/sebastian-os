import type { FastifyInstance } from "fastify";
import { computeExceptions } from "../../services/exceptions.js";

/**
 * Cockpit de excepciones (núcleo): UNA cola priorizada con todo lo que exige
 * acción del despachador ahora — rutas tarde, vehículos sin señal, desvíos,
 * entregas fallidas por recuperar, EVs con batería baja y direcciones sin
 * confirmar. Es la pantalla de inicio operativa del día.
 */
export default async function exceptionsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request) => {
    const items = await computeExceptions(request.user.tenantId);
    return { generatedAt: new Date().toISOString(), items };
  });
}
