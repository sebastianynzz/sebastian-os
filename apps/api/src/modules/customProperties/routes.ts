import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { customPropertySchema, customPropertyCap } from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { requireRole } from "../../plugins/auth.js";

/**
 * Propiedades personalizadas de parada (Tier 2 §9): el tenant define campos
 * extra (p. ej. "Piso", "# factura") con visibilidad por campo para el
 * CONDUCTOR (app) y/o el DESTINATARIO (rastreo público, B2B). El valor por
 * pedido vive en Order.customFields. El número de campos se limita por plan
 * (upsell, Tier 3). Tenant-scoped; mutaciones solo ADMIN.
 */
export default async function customPropertiesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // Lista de campos + contexto del tope del plan (para el banner de upsell).
  app.get("/", async (request) => {
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: request.user.tenantId },
      select: { plan: true },
    });
    const items = await prisma.customProperty.findMany({
      where: { tenantId: request.user.tenantId },
      orderBy: { createdAt: "asc" },
    });
    const cap = customPropertyCap(tenant.plan);
    return { items, cap, used: items.length, plan: tenant.plan };
  });

  app.post("/", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const input = customPropertySchema.parse(request.body);
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: request.user.tenantId },
      select: { plan: true },
    });
    const cap = customPropertyCap(tenant.plan);
    const used = await prisma.customProperty.count({
      where: { tenantId: request.user.tenantId },
    });
    // Tope por plan con upsell: el gancho de "mejora tu plan" (Tier 3).
    if (used >= cap) {
      return reply.code(409).send({
        error: `Alcanzaste el límite de ${cap} campos personalizados del plan ${tenant.plan}. Mejora tu plan para agregar más.`,
        code: "CUSTOM_PROPERTY_LIMIT",
        cap,
        plan: tenant.plan,
      });
    }
    const created = await prisma.customProperty.create({
      data: { ...input, tenantId: request.user.tenantId },
    });
    return reply.code(201).send(created);
  });

  app.patch("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const input = customPropertySchema.partial().parse(request.body);
    const existing = await prisma.customProperty.findFirst({
      where: { id, tenantId: request.user.tenantId },
    });
    if (!existing) return reply.code(404).send({ error: "Campo no encontrado" });
    return prisma.customProperty.update({ where: { id }, data: input });
  });

  app.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const existing = await prisma.customProperty.findFirst({
      where: { id, tenantId: request.user.tenantId },
    });
    if (!existing) return reply.code(404).send({ error: "Campo no encontrado" });
    // Los valores ya guardados en Order.customFields quedan huérfanos pero
    // inertes: selectVisibleFields solo muestra campos con definición vigente.
    await prisma.customProperty.delete({ where: { id } });
    return reply.code(204).send();
  });
}
