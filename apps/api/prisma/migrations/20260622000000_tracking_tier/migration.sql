-- Tier 2: nivel de privacidad de la página pública de rastreo por tenant.
-- Aditiva con DEFAULT (rellena las filas existentes con FULL = comportamiento
-- actual); segura para `prisma migrate deploy`.

ALTER TABLE "Tenant" ADD COLUMN "trackingTier" TEXT NOT NULL DEFAULT 'FULL';
