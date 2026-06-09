const DEV_JWT_SECRET = "dev-secret-cambiar-en-produccion";
const isProd = process.env.NODE_ENV === "production";

const jwtSecret = process.env.JWT_SECRET ?? DEV_JWT_SECRET;

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

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 3000),
  jwtSecret,
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
