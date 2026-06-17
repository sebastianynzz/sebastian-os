import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import {
  createVehicleSchema,
  CORE_MODULE_KEYS,
  initialModulesForBusinessModel,
  MODULE_CATALOG,
  MODULE_KEYS,
  modulesBlockingDisable,
  modulesToEnableWith,
  moduleName,
  TENANT_BUSINESS_MODELS,
  TENANT_OPERATOR_TYPES,
  TENANT_PLANS,
  updateTenantSchema,
  type ModuleKey,
} from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { invalidateTenantStatus } from "../../plugins/tenantStatus.js";
import { auditPlatform, shallowDiff } from "../../services/platformAudit.js";

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
      businessModel: t.businessModel,
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
        businessModel: z.enum(TENANT_BUSINESS_MODELS).default("FAAS"),
        parentTenantId: z.string().optional(),
        adminName: z.string().min(2),
        adminEmail: z.string().email(),
        adminPassword: z.string().min(8),
        // Asistente de onboarding (A3): selección explícita de módulos que
        // reemplaza el preset del modelo de negocio. Los de núcleo van igual.
        modules: z.array(z.enum(MODULE_KEYS)).optional(),
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

    // Selección explícita del asistente, o la fórmula única compartida
    // (defaults ∪ preset comercial ∪ núcleo) — la misma que usa el wizard
    // del panel, así nunca divergen. Los de núcleo siempre activos.
    const enabledKeys = input.modules
      ? new Set(input.modules)
      : initialModulesForBusinessModel(input.businessModel);
    const tenant = await prisma.tenant.create({
      data: {
        name: input.name,
        nit: input.nit,
        city: input.city,
        plan: input.plan,
        operatorType: input.operatorType,
        businessModel: input.businessModel,
        parentTenantId: input.parentTenantId,
        entitlements: {
          create: MODULE_CATALOG.map((m) => ({
            moduleKey: m.key,
            enabled: m.core === true || enabledKeys.has(m.key),
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
    await auditPlatform(request, "TENANT_PROVISION", {
      targetTenantId: tenant.id,
      details: {
        name: tenant.name,
        plan: tenant.plan,
        operatorType: tenant.operatorType,
        businessModel: tenant.businessModel,
        adminEmail: admin.email,
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
    await auditPlatform(request, "VEHICLE_ASSIGN", {
      targetTenantId: id,
      details: {
        vehicleId: vehicle.id,
        plate: vehicle.plate,
        type: vehicle.type,
        ownerTenantId: vehicle.ownerTenantId,
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
    // Vista cruzada de plataforma (FaaS): adjunta la última posición conocida de
    // cada activo para pintarlo en el mapa de flota. Telemetría EV-only
    // (Constraint 1): solo lat/lng/velocidad + marca de tiempo (para detectar
    // pings rancios) — NUNCA RPM/combustible/refrigerante. El ping se acota al
    // tenant operador (usa el índice [tenantId, vehicleId, recordedAt]); leer a
    // través de tenants aquí es la vista de flota de plataforma explícita.
    return Promise.all(
      vehicles.map(async (v) => {
        const last = await prisma.telemetryPing.findFirst({
          where: { tenantId: v.tenantId, vehicleId: v.id },
          orderBy: { recordedAt: "desc" },
          select: { lat: true, lng: true, speedKmh: true, recordedAt: true },
        });
        return {
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
          position: last
            ? {
                lat: last.lat,
                lng: last.lng,
                speedKmh: last.speedKmh,
                recordedAt: last.recordedAt,
              }
            : null,
        };
      }),
    );
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
      operatorType: tenant.operatorType,
      businessModel: tenant.businessModel,
      parentTenantId: tenant.parentTenantId,
      createdAt: tenant.createdAt,
      counts: tenant._count,
      modules: MODULE_CATALOG.map((m) => ({
        key: m.key,
        nombre: m.nombre,
        // Núcleo: siempre activo (EV-only — restricción dura 1.3).
        enabled: m.core === true || (enabledByKey.get(m.key) ?? false),
        core: m.core === true,
        requires: m.requires ?? [],
      })),
    };
  });

  /**
   * Actualizar el tenant: estado (suspender/reactivar), plan, datos de la
   * empresa (nombre/NIT/ciudad), tipo de operador y modelo de negocio. Todo
   * editable desde el panel; el cambio queda auditado con su diff.
   */
  app.patch("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = updateTenantSchema.parse(request.body);
    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) return reply.code(404).send({ error: "Tenant no encontrado" });

    const updated = await prisma.tenant.update({
      where: { id },
      data: {
        status: body.status,
        plan: body.plan,
        name: body.name,
        nit: body.nit === "" ? null : body.nit,
        city: body.city,
        operatorType: body.operatorType,
        businessModel: body.businessModel,
      },
    });
    if (body.status) invalidateTenantStatus(id); // suspensión inmediata
    await auditPlatform(request, "TENANT_UPDATE", {
      targetTenantId: id,
      details: shallowDiff(
        {
          status: tenant.status,
          plan: tenant.plan,
          name: tenant.name,
          nit: tenant.nit,
          city: tenant.city,
          operatorType: tenant.operatorType,
          businessModel: tenant.businessModel,
        },
        {
          status: updated.status,
          plan: updated.plan,
          name: updated.name,
          nit: updated.nit,
          city: updated.city,
          operatorType: updated.operatorType,
          businessModel: updated.businessModel,
        },
      ),
    });
    return {
      id: updated.id,
      status: updated.status,
      plan: updated.plan,
      name: updated.name,
      nit: updated.nit,
      city: updated.city,
      operatorType: updated.operatorType,
      businessModel: updated.businessModel,
    };
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
    if (CORE_MODULE_KEYS.has(params.key as ModuleKey)) {
      return reply.code(400).send({
        error: "Este módulo es parte del núcleo y no puede desactivarse",
        code: "CORE_MODULE",
      });
    }
    const tenant = await prisma.tenant.findUnique({ where: { id: params.id } });
    if (!tenant) return reply.code(404).send({ error: "Tenant no encontrado" });
    const key = params.key as ModuleKey;

    if (body.enabled) {
      // Habilitar arrastra sus dependencias (cascada).
      const toEnable = modulesToEnableWith(key);
      await prisma.$transaction(
        toEnable.map((moduleKey) =>
          prisma.moduleEntitlement.upsert({
            where: { tenantId_moduleKey: { tenantId: params.id, moduleKey } },
            create: { tenantId: params.id, moduleKey, enabled: true },
            update: { enabled: true },
          }),
        ),
      );
      await auditPlatform(request, "MODULE_TOGGLE", {
        targetTenantId: params.id,
        details: { moduleKey: key, enabled: true, cascade: toEnable },
      });
      return reply.send({ enabled: toEnable });
    }

    // Desactivar: bloquear si un módulo habilitado depende de este.
    const enabled = await prisma.moduleEntitlement.findMany({
      where: { tenantId: params.id, enabled: true },
    });
    const enabledKeys: ModuleKey[] = [
      ...CORE_MODULE_KEYS,
      ...enabled.map((e) => e.moduleKey as ModuleKey),
    ];
    const blockers = modulesBlockingDisable(key, enabledKeys);
    if (blockers.length > 0) {
      return reply.code(409).send({
        error: `No se puede desactivar: ${blockers.map(moduleName).join(", ")} ${
          blockers.length > 1 ? "dependen" : "depende"
        } de este módulo. Desactívalo(s) primero.`,
        code: "MODULE_DEPENDENCY",
        moduleKey: key,
        blockedBy: blockers,
      });
    }
    const entitlement = await prisma.moduleEntitlement.upsert({
      where: { tenantId_moduleKey: { tenantId: params.id, moduleKey: key } },
      create: { tenantId: params.id, moduleKey: key, enabled: false },
      update: { enabled: false },
    });
    await auditPlatform(request, "MODULE_TOGGLE", {
      targetTenantId: params.id,
      details: { moduleKey: key, enabled: false },
    });
    return entitlement;
  });

  /**
   * Consola de soporte (A4): entrar como un usuario del tenant para
   * diagnosticar/actuar en su nombre. Token de tenant de vida corta (30 min)
   * con el claim `impersonatedBy`, y SIEMPRE auditado — quién entró, a qué
   * tenant, como quién. Solo personal operativo (jamás CLIENT).
   */
  app.post("/:id/impersonate", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({ userId: z.string().optional() })
      .parse(request.body ?? {});

    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) return reply.code(404).send({ error: "Tenant no encontrado" });
    if (tenant.status === "SUSPENDED") {
      return reply.code(409).send({
        error: "Tenant suspendido: reactívalo antes de impersonar",
      });
    }

    const user = body.userId
      ? await prisma.user.findFirst({
          where: { id: body.userId, tenantId: id, role: { in: ["ADMIN", "DISPATCHER"] } },
        })
      : await prisma.user.findFirst({
          where: { tenantId: id, role: "ADMIN" },
          orderBy: { createdAt: "asc" },
        });
    if (!user) {
      return reply.code(404).send({
        error: "El tenant no tiene un usuario ADMIN/DISPATCHER para impersonar",
      });
    }

    const adminEmail = request.platformAdmin?.email ?? "plataforma";
    const token = app.jwt.sign(
      {
        typ: "tenant",
        sub: user.id,
        tenantId: id,
        role: user.role as "ADMIN" | "DISPATCHER",
        name: user.name,
        impersonatedBy: adminEmail,
      },
      { expiresIn: "30m" }, // sesión de soporte corta, nunca jornada completa
    );

    await auditPlatform(request, "IMPERSONATE", {
      targetTenantId: id,
      targetUserId: user.id,
      details: { tenant: tenant.name, como: user.email, rol: user.role },
    });

    return {
      token,
      expiresInMin: 30,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      webUrl: process.env.PUBLIC_WEB_URL ?? null,
    };
  });
}
