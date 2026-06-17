-- Aplazo de excepciones del cockpit: oculta una excepción derivada (por su
-- `key` estable) de la cola priorizada hasta `until`. Aditiva: nueva tabla,
-- segura para `migrate deploy`. No persiste la excepción, solo el aplazo.

CREATE TABLE "SnoozedException" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "key"             TEXT NOT NULL,
  "until"           TIMESTAMP(3) NOT NULL,
  "createdByUserId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SnoozedException_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SnoozedException_tenantId_key_key" ON "SnoozedException" ("tenantId", "key");

CREATE INDEX "SnoozedException_tenantId_until_idx" ON "SnoozedException" ("tenantId", "until");

ALTER TABLE "SnoozedException"
  ADD CONSTRAINT "SnoozedException_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
