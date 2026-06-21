import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import {
  loginSchema,
  registerTenantSchema,
  CORE_MODULE_KEYS,
  MODULE_CATALOG,
  type UserRole,
} from "@moveos/shared";
import { config } from "../../config.js";
import { prisma } from "../../lib/prisma.js";
import { invalidateUserToken, getUserTokenVersion } from "../../services/userTokens.js";
import {
  setRefreshCookie,
  clearRefreshCookie,
  TENANT_REFRESH_COOKIE,
  TENANT_REFRESH_PATH,
} from "../../lib/authCookies.js";

type AccessUser = {
  id: string;
  tenantId: string;
  role: string;
  driverId: string | null;
  clientId: string | null;
  name: string;
  tokenVersion: number;
};

// Hash señuelo para igualar el trabajo de bcrypt cuando el email no existe:
// sin esto, un email inexistente responde más rápido (no se hashea) y permite
// enumerar usuarios por tiempo. Se compara siempre contra un hash real.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("moveos-dummy-timing-guard", 10);

export default async function authRoutes(app: FastifyInstance) {
  // ACCESS token (corta vida, lo guarda la SPA en memoria) + REFRESH token
  // (cookie httpOnly, renueva el access sin exponer una credencial durable a JS).
  function issueAccessToken(u: AccessUser): string {
    return app.jwt.sign(
      {
        typ: "tenant",
        sub: u.id,
        tenantId: u.tenantId,
        role: u.role as UserRole,
        driverId: u.driverId ?? undefined,
        clientId: u.clientId ?? undefined,
        name: u.name,
        tv: u.tokenVersion,
      },
      { expiresIn: config.accessTokenTtl },
    );
  }
  function setRefresh(reply: Parameters<typeof setRefreshCookie>[0], u: AccessUser): void {
    const refresh = app.jwt.sign(
      { typ: "refresh", sub: u.id, tenantId: u.tenantId, tv: u.tokenVersion },
      { expiresIn: config.refreshTokenTtl },
    );
    setRefreshCookie(reply, TENANT_REFRESH_COOKIE, TENANT_REFRESH_PATH, refresh);
  }

  /** Registro self-service de un tenant nuevo (onboarding SMB). */
  app.post(
    "/register",
    {
      // Anti-abuso: el registro crea Tenant + entitlements + usuario ADMIN en
      // cada llamada. Sin tope, es un vector de spam de tenants / bloat de BD.
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
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

    const token = issueAccessToken(user);
    setRefresh(reply, user);
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
    // Compara SIEMPRE (contra un hash señuelo si el usuario no existe) para que
    // el tiempo de respuesta no revele si el email está registrado.
    const passwordOk = await bcrypt.compare(
      input.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (!user || !passwordOk) {
      // Registro de seguridad (A09): deja rastro de intentos fallidos para
      // alertar sobre fuerza bruta / credential-stuffing. Nunca la contraseña.
      request.log.warn(
        { event: "auth.login_failed", email: input.email, ip: request.ip },
        "intento de inicio de sesión fallido",
      );
      return reply.code(401).send({ error: "Credenciales inválidas" });
    }
    // Bloquear acceso a tenants suspendidos (el include ya está cargado).
    if (user.tenant.status === "SUSPENDED") {
      return reply.code(403).send({
        error: "Cuenta suspendida. Contacte al administrador de la plataforma.",
        code: "TENANT_SUSPENDED",
      });
    }

    const token = issueAccessToken(user);
    setRefresh(reply, user);
    return {
      token,
      user: publicUser(user),
      tenant: { id: user.tenant.id, name: user.tenant.name, city: user.tenant.city },
      modules: sessionModules(user.tenant.entitlements),
    };
    },
  );

  /**
   * Renovar la sesión (MO-16): lee el REFRESH token de la cookie httpOnly,
   * verifica firma + revocación (tokenVersion) + estado del tenant, y emite un
   * ACCESS token nuevo (rotando además la cookie de refresh — sesión deslizante).
   * Lo llama la SPA al cargar (token en memoria perdido tras recargar) y cuando
   * el access token expira. CLIENT del portal incluido.
   */
  app.post("/refresh", async (request, reply) => {
    const raw = request.cookies[TENANT_REFRESH_COOKIE];
    const fail = (code: number, error: string, extra?: object) => {
      clearRefreshCookie(reply, TENANT_REFRESH_COOKIE, TENANT_REFRESH_PATH);
      return reply.code(code).send({ error, ...extra });
    };
    if (!raw) return reply.code(401).send({ error: "Sin sesión" });
    let claims: { typ?: string; sub?: string; tenantId?: string; tv?: number };
    try {
      claims = app.jwt.verify(raw);
    } catch {
      return fail(401, "Sesión inválida");
    }
    if (claims.typ !== "refresh" || !claims.sub || !claims.tenantId) {
      return fail(401, "Sesión inválida");
    }
    const current = await getUserTokenVersion(claims.sub);
    if (current === null || (claims.tv !== undefined && current !== claims.tv)) {
      return fail(401, "Sesión finalizada", { code: "TOKEN_REVOKED" });
    }
    const user = await prisma.user.findUnique({
      where: { id: claims.sub },
      include: { tenant: { include: { entitlements: true } } },
    });
    if (!user) return fail(401, "Sesión inválida");
    if (user.tenant.status === "SUSPENDED") {
      return reply.code(403).send({
        error: "Cuenta suspendida. Contacte al administrador de la plataforma.",
        code: "TENANT_SUSPENDED",
      });
    }
    const token = issueAccessToken(user);
    setRefresh(reply, user);
    return {
      token,
      user: publicUser(user),
      tenant: { id: user.tenant.id, name: user.tenant.name, city: user.tenant.city },
      modules: sessionModules(user.tenant.entitlements),
    };
  });

  /**
   * Logout real: incrementa la versión de token del usuario, invalidando TODOS
   * sus JWT vigentes (≤12 h) — no solo borrar el token en el cliente. Disponible
   * para cualquier usuario del tenant, incluido el portal (CLIENT).
   */
  app.post(
    "/logout",
    { preHandler: [app.authenticateTenant] },
    async (request, reply) => {
      await prisma.user.update({
        where: { id: request.user.sub },
        data: { tokenVersion: { increment: 1 } },
      });
      invalidateUserToken(request.user.sub);
      clearRefreshCookie(reply, TENANT_REFRESH_COOKIE, TENANT_REFRESH_PATH);
      return { ok: true };
    },
  );

  app.get(
    "/me",
    // authenticateTenant: /me también responde a los usuarios del portal de
    // clientes (rol CLIENT); el resto del plano operativo les está cerrado.
    { preHandler: [app.authenticateTenant] },
    async (request) => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: request.user.sub },
        include: { tenant: { include: { entitlements: true } } },
      });
      return {
        user: publicUser(user),
        tenant: { id: user.tenant.id, name: user.tenant.name, city: user.tenant.city },
        modules: sessionModules(user.tenant.entitlements),
      };
    },
  );
}

/**
 * Módulos visibles de la sesión: entitlements activos + módulos de núcleo
 * (siempre presentes — p. ej. EV_MANAGEMENT en una plataforma EV-only).
 */
function sessionModules(
  entitlements: { moduleKey: string; enabled: boolean }[],
): string[] {
  const keys = new Set(
    entitlements.filter((e) => e.enabled).map((e) => e.moduleKey),
  );
  for (const key of CORE_MODULE_KEYS) keys.add(key);
  return [...keys];
}

function publicUser(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  driverId?: string | null;
  clientId?: string | null;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    driverId: user.driverId ?? null,
    clientId: user.clientId ?? null,
  };
}
