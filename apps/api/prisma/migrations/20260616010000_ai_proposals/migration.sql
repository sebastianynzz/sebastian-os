-- Capa de optimización con IA: almacén de propuestas pendientes (una sola ruta
-- de aplicación run → confirmar → apply; bitácora de auditoría de la IA).
-- Aditiva: nueva tabla, segura para `migrate deploy`.

CREATE TABLE "AiProposal" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "actionId"        TEXT NOT NULL,
  "scope"           TEXT NOT NULL,
  "summaryEs"       TEXT NOT NULL,
  "changeJson"      JSONB NOT NULL,
  "impactJson"      JSONB NOT NULL,
  "contextJson"     JSONB NOT NULL,
  "mutates"         BOOLEAN NOT NULL,
  "feasible"        BOOLEAN NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'PENDING',
  "expiresAt"       TIMESTAMP(3) NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedAt"       TIMESTAMP(3),
  "appliedByUserId" TEXT,
  CONSTRAINT "AiProposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiProposal_tenantId_status_idx" ON "AiProposal" ("tenantId", "status");

ALTER TABLE "AiProposal"
  ADD CONSTRAINT "AiProposal_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
