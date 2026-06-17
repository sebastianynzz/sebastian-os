-- D2: política de prueba de entrega (POD) configurable por tipo de parada.
-- Aditiva: columna nullable + tabla nueva (segura para `prisma migrate deploy`).

ALTER TABLE "ProofOfDelivery" ADD COLUMN "deliveryType" TEXT;

CREATE TABLE "PodPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'TEAM_DEFAULT',
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PodPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PodPolicy_tenantId_scope_key" ON "PodPolicy"("tenantId", "scope");
CREATE INDEX "PodPolicy_tenantId_idx" ON "PodPolicy"("tenantId");
