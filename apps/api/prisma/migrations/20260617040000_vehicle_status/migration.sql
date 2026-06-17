-- Disponibilidad operativa del vehículo fijada por despacho (ACTIVE |
-- MAINTENANCE | CHARGING). Aditiva con default 'ACTIVE': los vehículos
-- existentes quedan activos. Segura para `migrate deploy`.
ALTER TABLE "Vehicle" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
