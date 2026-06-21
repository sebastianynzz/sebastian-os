import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { loginSchema } from "@moveos/shared";
import { config } from "../../config.js";
import { prisma } from "../../lib/prisma.js";
import {
  setRefreshCookie,
  clearRefreshCookie,
  PLATFORM_REFRESH_COOKIE,
  PLATFORM_REFRESH_PATH,
} from "../../lib/authCookies.js";

// Hash señuelo: comparar siempre evita enumerar operadores por tiempo de respuesta.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("moveos-dummy-timing-guard", 10);

/** Autenticación del operador de plataforma (plano separado de los tenants). */
export default async function platformAuthRoutes(app: FastifyInstance) {
  type Admin = { id: string; email: string; name: string };
  function issueAccessToken(admin: Admin): string {
    return app.jwt.sign(
      { typ: "platform", sub: admin.id, email: admin.email, name: admin.name, platformAdmin: true },
      { expiresIn: config.accessTokenTtl },
    );
  }
  function setRefresh(reply: Parameters<typeof setRefreshCookie>[0], admin: Admin): void {
    const refresh = app.jwt.sign(
      { typ: "platform-refresh", sub: admin.id, email: admin.email, name: admin.name },
      { expiresIn: config.refreshTokenTtl },
    );
    setRefreshCookie(reply, PLATFORM_REFRESH_COOKIE, PLATFORM_REFRESH_PATH, refresh);
  }

  app.post(
    "/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = loginSchema.parse(request.body);
      const admin = await prisma.platformAdmin.findUnique({
        where: { email: input.email },
      });
      const passwordOk = await bcrypt.compare(
        input.password,
        admin?.passwordHash ?? DUMMY_PASSWORD_HASH,
      );
      if (!admin || !passwordOk) {
        return reply.code(401).send({ error: "Credenciales inválidas" });
      }
      const token = issueAccessToken(admin);
      setRefresh(reply, admin);
      return { token, admin: { id: admin.id, email: admin.email, name: admin.name } };
    },
  );

  /** Renovar la sesión de plataforma desde la cookie httpOnly de refresh. */
  app.post("/refresh", async (request, reply) => {
    const raw = request.cookies[PLATFORM_REFRESH_COOKIE];
    const fail = () => {
      clearRefreshCookie(reply, PLATFORM_REFRESH_COOKIE, PLATFORM_REFRESH_PATH);
      return reply.code(401).send({ error: "Sesión inválida" });
    };
    if (!raw) return reply.code(401).send({ error: "Sin sesión" });
    let claims: { typ?: string; sub?: string };
    try {
      claims = app.jwt.verify(raw);
    } catch {
      return fail();
    }
    if (claims.typ !== "platform-refresh" || !claims.sub) return fail();
    const admin = await prisma.platformAdmin.findUnique({ where: { id: claims.sub } });
    if (!admin) return fail();
    const token = issueAccessToken(admin);
    setRefresh(reply, admin);
    return { token, admin: { id: admin.id, email: admin.email, name: admin.name } };
  });

  /** Logout de plataforma: borra la cookie de refresh (el access expira solo). */
  app.post("/logout", async (_request, reply) => {
    clearRefreshCookie(reply, PLATFORM_REFRESH_COOKIE, PLATFORM_REFRESH_PATH);
    return { ok: true };
  });

  app.get(
    "/me",
    { preHandler: [app.requirePlatformAdmin] },
    async (request) => {
      const admin = request.platformAdmin!;
      return { admin: { id: admin.sub, email: admin.email, name: admin.name } };
    },
  );
}
