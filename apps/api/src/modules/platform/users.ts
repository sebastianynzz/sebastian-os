import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import {
  platformCreateUserSchema,
  platformUpdateUserSchema,
} from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";
import { auditPlatform } from "../../services/platformAudit.js";
import { invalidateUserToken } from "../../services/userTokens.js";

/**
 * Gestión del EQUIPO de un tenant desde el panel de plataforma (soporte de
 * MOVE): crear staff ADMIN/DISPATCHER, cambiar rol/nombre, resetear
 * contraseña y eliminar. Conductores (DRIVER, vinculados a `driverId`) y
 * usuarios del portal (CLIENT) se gestionan desde el dashboard del tenant; en
 * esta lista aparecen solo lectura.
 *
 * Nota de seguridad documentada: resetear contraseña o eliminar no revoca los
 * JWT ya emitidos (viven ≤12 h) — mismo riesgo aceptado que la caché de
 * suspensión; el fix futuro es un claim de versión de token.
 */
export default async function platformTenantUsersRoutes(app: FastifyInstance) {
  const tenantParam = z.object({ id: z.string() });
  const userParam = z.object({ id: z.string(), userId: z.string() });

  async function findTenant(id: string) {
    return prisma.tenant.findUnique({ where: { id }, select: { id: true } });
  }

  /** ¿Es este el último ADMIN del tenant? (no se puede degradar/eliminar). */
  async function isLastAdmin(tenantId: string, userId: string) {
    const admins = await prisma.user.findMany({
      where: { tenantId, role: "ADMIN" },
      select: { id: true },
    });
    return admins.length === 1 && admins[0]?.id === userId;
  }

  app.get("/", async (request, reply) => {
    const { id } = tenantParam.parse(request.params);
    if (!(await findTenant(id))) {
      return reply.code(404).send({ error: "Tenant no encontrado" });
    }
    const users = await prisma.user.findMany({
      where: { tenantId: id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        driverId: true,
        clientId: true,
        createdAt: true,
      },
    });
    return users.map((u) => ({
      ...u,
      // Staff editable desde plataforma; DRIVER/CLIENT solo lectura aquí.
      manageable: u.role === "ADMIN" || u.role === "DISPATCHER",
    }));
  });

  app.post("/", async (request, reply) => {
    const { id } = tenantParam.parse(request.params);
    const input = platformCreateUserSchema.parse(request.body);
    if (!(await findTenant(id))) {
      return reply.code(404).send({ error: "Tenant no encontrado" });
    }
    const existing = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      return reply.code(409).send({ error: "El correo ya está registrado" });
    }
    const user = await prisma.user.create({
      data: {
        tenantId: id,
        name: input.name,
        email: input.email,
        role: input.role,
        passwordHash: await bcrypt.hash(input.password, 10),
      },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
    await auditPlatform(request, "USER_CREATE", {
      targetTenantId: id,
      targetUserId: user.id,
      details: { email: user.email, role: user.role },
    });
    return reply.code(201).send(user);
  });

  app.patch("/:userId", async (request, reply) => {
    const { id, userId } = userParam.parse(request.params);
    const input = platformUpdateUserSchema.parse(request.body);
    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId: id },
    });
    if (!user) return reply.code(404).send({ error: "Usuario no encontrado" });
    if (user.role !== "ADMIN" && user.role !== "DISPATCHER") {
      return reply.code(400).send({
        error:
          "Solo el staff (ADMIN/DISPATCHER) se gestiona aquí; conductores y portal, desde el dashboard del tenant",
      });
    }
    if (
      input.role === "DISPATCHER" &&
      user.role === "ADMIN" &&
      (await isLastAdmin(id, userId))
    ) {
      return reply
        .code(400)
        .send({ error: "No se puede degradar al último ADMIN del tenant" });
    }

    // Revocar los JWT vigentes del usuario si se le resetea la contraseña o se
    // cambia su rol (un token viejo conservaría el rol/acceso anterior ≤12 h).
    const revoke =
      Boolean(input.newPassword) ||
      (input.role !== undefined && input.role !== user.role);
    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        name: input.name,
        role: input.role,
        ...(input.newPassword
          ? { passwordHash: await bcrypt.hash(input.newPassword, 10) }
          : {}),
        ...(revoke ? { tokenVersion: { increment: 1 } } : {}),
      },
      select: { id: true, name: true, email: true, role: true },
    });
    if (revoke) invalidateUserToken(userId);
    if (input.newPassword) {
      await auditPlatform(request, "USER_RESET_PASSWORD", {
        targetTenantId: id,
        targetUserId: userId,
        details: { email: updated.email }, // nunca la contraseña
      });
    }
    if (input.name !== undefined || input.role !== undefined) {
      await auditPlatform(request, "USER_UPDATE", {
        targetTenantId: id,
        targetUserId: userId,
        details: {
          email: updated.email,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.role !== undefined ? { role: input.role } : {}),
        },
      });
    }
    return updated;
  });

  app.delete("/:userId", async (request, reply) => {
    const { id, userId } = userParam.parse(request.params);
    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId: id },
    });
    if (!user) return reply.code(404).send({ error: "Usuario no encontrado" });
    if (user.role !== "ADMIN" && user.role !== "DISPATCHER") {
      return reply.code(400).send({
        error:
          "Solo el staff (ADMIN/DISPATCHER) se gestiona aquí; conductores y portal, desde el dashboard del tenant",
      });
    }
    if (await isLastAdmin(id, userId)) {
      return reply
        .code(400)
        .send({ error: "No se puede eliminar al último ADMIN del tenant" });
    }
    await prisma.user.delete({ where: { id: userId } });
    // El usuario ya no existe: limpiar la caché para que sus tokens dejen de
    // validar de inmediato (getUserTokenVersion → null → 401) sin esperar al TTL.
    invalidateUserToken(userId);
    await auditPlatform(request, "USER_DELETE", {
      targetTenantId: id,
      targetUserId: userId,
      details: { email: user.email, role: user.role },
    });
    return { ok: true };
  });
}
