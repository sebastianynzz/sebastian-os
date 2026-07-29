const DEV_JWT_SECRET = "dev-secret-cambiar-en-produccion";
const isProd = process.env.NODE_ENV === "production";

// Un JWT_SECRET vacío o en blanco haría que se firme/verifique con secreto
// vacío (clase de bypass de HMAC en algunas versiones de fast-jwt): tratar
// "" / espacios como "no definido" para nunca pasar un secreto vacío al firmador.
const envSecret = process.env.JWT_SECRET?.trim();
const jwtSecret = envSecret && envSecret.length > 0 ? envSecret : DEV_JWT_SECRET;

// Falla en arranque si producción no define un secreto fuerte: nunca correr
// en producción con el secreto de desarrollo.
if (isProd && (jwtSecret === DEV_JWT_SECRET || jwtSecret.length < 32)) {
  throw new Error(
    "JWT_SECRET debe definirse con un valor fuerte (>=32 chars) en producción.",
  );
}

/**
 * Orígenes permitidos para CORS. En desarrollo se permiten los puertos locales
 * de las tres apps; en producción se exige CORS_ORIGINS explícito.
 */
const corsOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// Sesiones (MO-16): el dashboard y el panel de plataforma guardan el ACCESS
// token en memoria (no en localStorage) y renuevan con un REFRESH token en una
// cookie httpOnly (no legible por JS → un XSS no puede robar la sesión durable).
const accessTokenTtl = process.env.ACCESS_TOKEN_TTL ?? "12h";
const refreshTokenDays = Number(process.env.REFRESH_TOKEN_DAYS ?? 7);
// Cookie del refresh: en prod, SPA↔API suele ser cross-site (Vercel ↔ Render),
// así que el default seguro es SameSite=None;Secure (funciona también same-site).
// Si las apps comparten dominio (app./api.moveos.co) puede ponerse "lax".
const cookieSameSite = (process.env.AUTH_COOKIE_SAMESITE ??
  (isProd ? "none" : "lax")) as "lax" | "none" | "strict";
const cookieSecure =
  process.env.AUTH_COOKIE_SECURE != null
    ? process.env.AUTH_COOKIE_SECURE === "true"
    : isProd;
const cookieDomain = process.env.AUTH_COOKIE_DOMAIN || undefined;

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 3000),
  jwtSecret,
  accessTokenTtl,
  refreshTokenTtl: `${refreshTokenDays}d`,
  refreshMaxAgeSec: refreshTokenDays * 24 * 60 * 60,
  cookieSameSite,
  cookieSecure,
  cookieDomain,
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://moveos:moveos@localhost:5432/moveos",
  corsOrigins:
    corsOrigins.length > 0
      ? corsOrigins
      : isProd
        ? []
        : [
            "http://localhost:5173",
            "http://localhost:5174",
            "http://localhost:5175",
          ],
};
