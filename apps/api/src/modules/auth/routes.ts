import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { loginSchema, registerTenantSchema, MODULE_CATALOG } from "@moveos/shared";
import { prisma } from "../../lib/prisma.js";

export default async function authRoutes(app: FastifyInstance) {
  /** Registro self-service de un tenant nuevo (onboarding SMB). */
  app.post("/register", async (request, reply) => {
    const input = registerTenantSchema.parse(request.body);

    const existing = await prisma.user.findUnique({
      where: { email: input.email },
    });
    if (existing) {
      return reply.code(409).send({ error: "El correo ya está registrado" });
    }

    const tenant = await prisma.tenant.create({
      data: {
        name: input.tenantName,
        nit: input.nit,
        city: input.city,
        entitlements: {
          create: MODULE_CATALOG.map((m) => ({
            moduleKey: m.key,
            enabled: m.defaultEnabled,
          })),
        },
      },
    });

    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: input.email,
        passwordHash: await bcrypt.hash(input.password, 10),
        name: input.adminName,
        role: "ADMIN",
      },
    });

    const token = app.jwt.sign({
      sub: user.id,
      tenantId: tenant.id,
      role: "ADMIN",
      name: user.name,
    });
    return reply.code(201).send({ token, tenant, user: publicUser(user) });
  });

  app.post(
    "/login",
    {
      // Endurece el endpoint de credenciales contra fuerza bruta.
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({
      where: { email: input.email },
      include: { tenant: { include: { entitlements: true } } },
    });
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      return reply.code(401).send({ error: "Credenciales inválidas" });
    }

    const token = app.jwt.sign({
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role as "ADMIN" | "DISPATCHER" | "DRIVER",
      driverId: user.driverId ?? undefined,
      name: user.name,
    });
    return {
      token,
      user: publicUser(user),
      tenant: { id: user.tenant.id, name: user.tenant.name, city: user.tenant.city },
      modules: user.tenant.entitlements
        .filter((e) => e.enabled)
        .map((e) => e.moduleKey),
    };
    },
  );

  app.get(
    "/me",
    { preHandler: [app.authenticate] },
    async (request) => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: request.user.sub },
        include: { tenant: { include: { entitlements: true } } },
      });
      return {
        user: publicUser(user),
        tenant: { id: user.tenant.id, name: user.tenant.name, city: user.tenant.city },
        modules: user.tenant.entitlements
          .filter((e) => e.enabled)
          .map((e) => e.moduleKey),
      };
    },
  );
}

function publicUser(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  driverId?: string | null;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    driverId: user.driverId ?? null,
  };
}
