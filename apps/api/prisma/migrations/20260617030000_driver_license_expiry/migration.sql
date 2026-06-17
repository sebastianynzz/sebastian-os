-- Vencimiento de licencia del conductor: alimenta los recordatorios de
-- cumplimiento del panel (vencida / por vencer). Aditiva y anulable: opcional
-- al crear, segura para `migrate deploy`.
ALTER TABLE "Driver" ADD COLUMN "licenseExpiresAt" TIMESTAMP(3);
