import type { FastifyReply } from "fastify";
import { config } from "../config.js";

/**
 * Cookies del REFRESH token (MO-16). El refresh token va en una cookie httpOnly
 * (no legible por JavaScript → un XSS no puede robar la credencial durable) y
 * acotada por `Path` al endpoint de auth correspondiente, para que no se envíe
 * en cada request normal de la API. El ACCESS token, en cambio, lo guarda la SPA
 * en memoria y lo manda como `Authorization: Bearer`.
 */

export const TENANT_REFRESH_COOKIE = "mv_rt";
export const PLATFORM_REFRESH_COOKIE = "mv_prt";
export const TENANT_REFRESH_PATH = "/auth";
export const PLATFORM_REFRESH_PATH = "/platform/auth";

function baseOpts(path: string) {
  return {
    httpOnly: true as const,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    path,
    ...(config.cookieDomain ? { domain: config.cookieDomain } : {}),
  };
}

export function setRefreshCookie(
  reply: FastifyReply,
  name: string,
  path: string,
  token: string,
): void {
  reply.setCookie(name, token, { ...baseOpts(path), maxAge: config.refreshMaxAgeSec });
}

export function clearRefreshCookie(
  reply: FastifyReply,
  name: string,
  path: string,
): void {
  reply.clearCookie(name, baseOpts(path));
}
