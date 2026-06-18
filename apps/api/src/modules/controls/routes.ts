import type { FastifyInstance } from "fastify";
import {
  billingProfileSchema,
  costConfigSchema,
  defaultPodPolicyConfig,
  defaultDriverPermissionPolicy,
  driverPermissionPolicySchema,
  messageTemplateSchema,
  podPolicyConfigSchema,
  trackingTierSchema,
  DEFAULT_DRIVER_COST_PER_HOUR_COP,
  DEFAULT_ENERGY_TARIFF_COP,
  DEFAULT_NOTIFICATION_BODIES,
  NOTIFICATION_EVENTS,
  type NotificationEvent,
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

  /**
   * Parámetros de costo del tenant (D6, energía-nativo): costo del conductor por
   * hora y tarifa de energía (COP/kWh). Alimentan el costo por entrega en
   * analítica. En null se devuelven los valores por defecto compartidos.
   */
  app.get("/cost", async (request) => {
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: request.user.tenantId },
      select: { driverCostPerHourCop: true, energyTariffCop: true },
    });
    return {
      driverCostPerHourCop: tenant.driverCostPerHourCop ?? DEFAULT_DRIVER_COST_PER_HOUR_COP,
      energyTariffCop: tenant.energyTariffCop ?? DEFAULT_ENERGY_TARIFF_COP,
    };
  });

  app.patch("/cost", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const parsed = costConfigSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Configuración de costos inválida" });
    }
    const updated = await prisma.tenant.update({
      where: { id: request.user.tenantId },
      data: parsed.data,
      select: { driverCostPerHourCop: true, energyTariffCop: true },
    });
    return {
      driverCostPerHourCop: updated.driverCostPerHourCop ?? DEFAULT_DRIVER_COST_PER_HOUR_COP,
      energyTariffCop: updated.energyTariffCop ?? DEFAULT_ENERGY_TARIFF_COP,
    };
  });

  /**
   * Privacidad de la página pública de rastreo (Tier 2, B2B): ETA_ONLY |
   * ETA_POSITION | FULL. Controla cuánto ve quien abre el enlace público.
   */
  app.get("/tracking", async (request) => {
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: request.user.tenantId },
      select: { trackingTier: true },
    });
    return { trackingTier: tenant.trackingTier };
  });

  app.patch("/tracking", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const parsed = trackingTierSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Nivel de rastreo inválido" });
    }
    const updated = await prisma.tenant.update({
      where: { id: request.user.tenantId },
      data: { trackingTier: parsed.data.trackingTier },
      select: { trackingTier: true },
    });
    return { trackingTier: updated.trackingTier };
  });

  /**
   * Motor de notificaciones B2B (Tier 2): por evento del ciclo de vida, ¿se
   * notifica al negocio cliente y con qué cuerpo? Sin fila = cuerpo por defecto
   * y activo. Solo se notifica al NEGOCIO, nunca al consumidor final.
   */
  app.get("/notifications", async (request) => {
    const rows = await prisma.messageTemplate.findMany({
      where: { tenantId: request.user.tenantId },
    });
    const byEvent = new Map(rows.map((r) => [r.event, r]));
    return NOTIFICATION_EVENTS.map((event) => {
      const row = byEvent.get(event);
      return {
        event,
        enabled: row?.enabled ?? true,
        body: row?.body ?? DEFAULT_NOTIFICATION_BODIES[event as NotificationEvent],
        isDefault: !row,
      };
    });
  });

  app.patch("/notifications", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const parsed = messageTemplateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Plantilla de notificación inválida" });
    }
    const { event, enabled, body } = parsed.data;
    const row = await prisma.messageTemplate.upsert({
      where: { tenantId_event: { tenantId: request.user.tenantId, event } },
      create: { tenantId: request.user.tenantId, event, enabled, body },
      update: { enabled, body },
    });
    return { event: row.event, enabled: row.enabled, body: row.body, isDefault: false };
  });

  /**
   * Permisos de la app del conductor (Tier 2 §10): app de navegación preferida
   * (deeplinks) y qué puede hacer el conductor con las rutas. Sin fila = la
   * política por defecto (app "bloqueada", solo ejecuta su ruta). La LEE
   * cualquier usuario del tenant (la app del conductor la consulta); la edita
   * solo ADMIN.
   */
  app.get("/driver-permissions", async (request) => {
    const row = await prisma.driverPermissionPolicy.findUnique({
      where: { tenantId: request.user.tenantId },
    });
    const base = defaultDriverPermissionPolicy();
    return {
      navApp: row?.navApp ?? base.navApp,
      allowEditDispatcherRoutes:
        row?.allowEditDispatcherRoutes ?? base.allowEditDispatcherRoutes,
      allowCreateRoutes: row?.allowCreateRoutes ?? base.allowCreateRoutes,
      allowEditStartedRoutes:
        row?.allowEditStartedRoutes ?? base.allowEditStartedRoutes,
      granular: (row?.granular as Record<string, boolean> | null) ?? undefined,
    };
  });

  app.patch(
    "/driver-permissions",
    { preHandler: [requireRole("ADMIN")] },
    async (request, reply) => {
      const parsed = driverPermissionPolicySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Permisos de conductor inválidos" });
      }
      const data = parsed.data;
      const row = await prisma.driverPermissionPolicy.upsert({
        where: { tenantId: request.user.tenantId },
        create: { tenantId: request.user.tenantId, ...data },
        update: data,
      });
      return {
        navApp: row.navApp,
        allowEditDispatcherRoutes: row.allowEditDispatcherRoutes,
        allowCreateRoutes: row.allowCreateRoutes,
        allowEditStartedRoutes: row.allowEditStartedRoutes,
        granular: (row.granular as Record<string, boolean> | null) ?? undefined,
      };
    },
  );

  /**
   * Facturación de la suscripción SaaS (Tier 3 §13): datos fiscales del tenant +
   * historial de facturas (las emite la plataforma). MoveOS NO procesa pagos en
   * la app (sin COD): es una vista de cuenta. Lectura para cualquier usuario del
   * tenant; el perfil lo edita ADMIN. Tenant-scoped.
   */
  app.get("/billing", async (request) => {
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: request.user.tenantId },
      select: {
        legalName: true,
        nit: true,
        billingEmail: true,
        billingAddress: true,
        plan: true,
      },
    });
    const invoices = await prisma.invoice.findMany({
      where: { tenantId: request.user.tenantId },
      orderBy: { issuedAt: "desc" },
    });
    return { profile: tenant, invoices };
  });

  app.patch("/billing", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const parsed = billingProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Datos de facturación inválidos" });
    }
    const updated = await prisma.tenant.update({
      where: { id: request.user.tenantId },
      data: parsed.data,
      select: {
        legalName: true,
        nit: true,
        billingEmail: true,
        billingAddress: true,
        plan: true,
      },
    });
    return updated;
  });
}
