-- D6: configuración de costos por tenant (energía-nativo).
-- Aditiva: columnas nullable (seguras para `prisma migrate deploy`); en null se
-- usan los valores por defecto compartidos.

ALTER TABLE "Tenant" ADD COLUMN "driverCostPerHourCop" INTEGER;
ALTER TABLE "Tenant" ADD COLUMN "energyTariffCop" DOUBLE PRECISION;
