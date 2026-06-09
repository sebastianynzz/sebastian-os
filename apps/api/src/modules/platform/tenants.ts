import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MODULE_CATALOG, updateTenantSchema } from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { invalidateTenantStatus } from "../../plugins/tenantStatus.js";

/**
 * Gestión de tenants desde el panel del operador de plataforma. Todas las
 * rutas exigen `requirePlatformAdmin` (registrado en el padre).
 */
export default async function platformTenantsRoutes(app: FastifyInstance) {
  /** Lista de tenants con conteos de uso (una sola consulta, sin N+1). */
  app.get("/", async () => {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const [tenants, recentOrders] = await Promise.all([
      prisma.tenant.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          _count: {
            select: { users: true, drivers: true, vehicles: true, orders: true, routes: true, clients: true },
          },
        },
      }),
      prisma.order.groupBy({
        by: ["tenantId"],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
    ]);
    const recentByTenant = new Map(recentOrders.map((r) => [r.tenantId, r._count._all]));
    return tenants.map((t) => ({
      id: t.id,
      name: t.name,
      city: t.city,
      nit: t.nit,
      status: t.status,
      plan: t.plan,
      createdAt: t.createdAt,
      counts: t._count,
      ordersLast30d: recentByTenant.get(t.id) ?? 0,
    }));
  });

  /** Detalle de un tenant con la matriz completa de módulos. */
  app.get("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        entitlements: true,
        _count: {
          select: { users: true, drivers: true, vehicles: true, orders: true, routes: true, clients: true },
        },
      },
    });
    if (!tenant) return reply.code(404).send({ error: "Tenant no encontrado" });

    const enabledByKey = new Map(tenant.entitlements.map((e) => [e.moduleKey, e.enabled]));
    return {
      id: tenant.id,
      name: tenant.name,
      city: tenant.city,
      nit: tenant.nit,
      status: tenant.status,
      plan: tenant.plan,
      createdAt: tenant.createdAt,
      counts: tenant._count,
      modules: MODULE_CATALOG.map((m) => ({
        key: m.key,
        nombre: m.nombre,
        enabled: enabledByKey.get(m.key) ?? false,
      })),
    };
  });

  /** Cambiar estado (suspender/reactivar) y/o plan. */
  app.patch("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = updateTenantSchema.parse(request.body);
    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) return reply.code(404).send({ error: "Tenant no encontrado" });

    const updated = await prisma.tenant.update({
      where: { id },
      data: { status: body.status, plan: body.plan },
    });
    if (body.status) invalidateTenantStatus(id); // suspensión inmediata
    return { id: updated.id, status: updated.status, plan: updated.plan };
  });

  /** Override de un módulo del tenant desde la plataforma. */
  app.patch("/:id/modules/:key", async (request, reply) => {
    const params = z
      .object({ id: z.string(), key: z.string() })
      .parse(request.params);
    const body = z.object({ enabled: z.boolean() }).parse(request.body);
    if (!MODULE_CATALOG.some((m) => m.key === params.key)) {
      return reply.code(400).send({ error: "Módulo desconocido" });
    }
    const tenant = await prisma.tenant.findUnique({ where: { id: params.id } });
    if (!tenant) return reply.code(404).send({ error: "Tenant no encontrado" });

    const entitlement = await prisma.moduleEntitlement.upsert({
      where: { tenantId_moduleKey: { tenantId: params.id, moduleKey: params.key } },
      create: { tenantId: params.id, moduleKey: params.key, enabled: body.enabled },
      update: { enabled: body.enabled },
    });
    return entitlement;
  });
}
