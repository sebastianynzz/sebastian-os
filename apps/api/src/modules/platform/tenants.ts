import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import {
  createVehicleSchema,
  MODULE_CATALOG,
  TENANT_OPERATOR_TYPES,
  TENANT_PLANS,
  updateTenantSchema,
} from "@moveos/shared";
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
      operatorType: t.operatorType,
      createdAt: t.createdAt,
      counts: t._count,
      ordersLast30d: recentByTenant.get(t.id) ?? 0,
    }));
  });

  /**
   * Aprovisionar un tenant desde la plataforma (fleet-as-a-service): MOVE crea
   * la cuenta de un cliente con vehículos en sitio (SUB_OPERATOR) junto con su
   * usuario administrador. El cliente opera solo; MOVE conserva la vista de
   * plataforma y la propiedad de los activos.
   */
  app.post("/", async (request, reply) => {
    const input = z
      .object({
        name: z.string().min(2),
        nit: z.string().min(5).optional(),
        city: z.string().default("Bogotá"),
        plan: z.enum(TENANT_PLANS).default("FREE"),
        operatorType: z.enum(TENANT_OPERATOR_TYPES).default("SUB_OPERATOR"),
        parentTenantId: z.string().optional(),
        adminName: z.string().min(2),
        adminEmail: z.string().email(),
        adminPassword: z.string().min(8),
      })
      .parse(request.body);

    const existing = await prisma.user.findUnique({
      where: { email: input.adminEmail },
      select: { id: true },
    });
    if (existing) {
      return reply.code(409).send({ error: "El correo del administrador ya está registrado" });
    }
    if (input.parentTenantId) {
      const parent = await prisma.tenant.findUnique({
        where: { id: input.parentTenantId },
        select: { id: true },
      });
      if (!parent) return reply.code(400).send({ error: "parentTenantId no existe" });
    }

    const tenant = await prisma.tenant.create({
      data: {
        name: input.name,
        nit: input.nit,
        city: input.city,
        plan: input.plan,
        operatorType: input.operatorType,
        parentTenantId: input.parentTenantId,
        entitlements: {
          create: MODULE_CATALOG.map((m) => ({
            moduleKey: m.key,
            enabled: m.defaultEnabled,
          })),
        },
      },
    });
    const admin = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: input.adminEmail,
        passwordHash: await bcrypt.hash(input.adminPassword, 10),
        name: input.adminName,
        role: "ADMIN",
      },
    });

    return reply.code(201).send({
      tenant,
      admin: { id: admin.id, email: admin.email, name: admin.name },
    });
  });

  /**
   * Asignar un vehículo (propiedad de MOVE) a un tenant sub-operador: el
   * vehículo queda en el tenant OPERADOR para todas las consultas operativas,
   * con ownerTenantId registrando la propiedad del activo.
   */
  app.post("/:id/vehicles", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const input = createVehicleSchema
      .extend({ ownerTenantId: z.string().optional() })
      .parse(request.body);

    const tenant = await prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!tenant) return reply.code(404).send({ error: "Tenant no encontrado" });
    if (input.ownerTenantId) {
      const owner = await prisma.tenant.findUnique({
        where: { id: input.ownerTenantId },
        select: { id: true },
      });
      if (!owner) return reply.code(400).send({ error: "ownerTenantId no existe" });
    }

    const vehicle = await prisma.vehicle.create({
      data: {
        tenantId: id,
        ownerTenantId: input.ownerTenantId,
        plate: input.plate.toUpperCase().replace(/\s/g, ""),
        type: input.type,
        capacityKg: input.capacityKg,
        capacityM3: input.capacityM3,
        isElectric: input.isElectric,
        batteryKwh: input.batteryKwh,
        nominalRangeKm: input.nominalRangeKm,
      },
    });
    return reply.code(201).send(vehicle);
  });

  /**
   * Flota cruzada (solo plano de plataforma): los vehículos cuyo dueño es un
   * tenant (MOVE) operando en OTROS tenants — utilización del activo, estado
   * de telemetría y SoC, agrupados sin cruzar el plano de datos de cada uno.
   */
  app.get("/fleet/owned", async () => {
    const vehicles = await prisma.vehicle.findMany({
      where: { ownerTenantId: { not: null } },
      include: { tenant: { select: { id: true, name: true, operatorType: true } } },
      orderBy: { createdAt: "desc" },
    });
    const ownerIds = [...new Set(vehicles.map((v) => v.ownerTenantId!))];
    const owners = await prisma.tenant.findMany({
      where: { id: { in: ownerIds } },
      select: { id: true, name: true },
    });
    const ownerName = new Map(owners.map((o) => [o.id, o.name]));
    return vehicles.map((v) => ({
      id: v.id,
      plate: v.plate,
      type: v.type,
      isElectric: v.isElectric,
      socPercent: v.socPercent,
      engineOn: v.engineOn,
      immobilized: v.immobilized,
      lastSpeedKmh: v.lastSpeedKmh,
      lastSeenAt: v.lastSeenAt,
      operatedBy: v.tenant,
      ownerTenantId: v.ownerTenantId,
      ownerName: ownerName.get(v.ownerTenantId!) ?? null,
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
