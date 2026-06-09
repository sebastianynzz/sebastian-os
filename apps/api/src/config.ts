export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-cambiar-en-produccion",
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://moveos:moveos@localhost:5432/moveos",
};
