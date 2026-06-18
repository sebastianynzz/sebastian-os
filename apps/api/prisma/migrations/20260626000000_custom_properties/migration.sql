-- Tier 2 §9: propiedades personalizadas de parada — definición por tenant
-- (visibilidad por conductor/destinatario) + valores por pedido en
-- Order.customFields. Aditiva (tabla nueva + columna nullable); segura para
-- `prisma migrate deploy`.

CREATE TABLE "CustomProperty" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visibleToDriver" BOOLEAN NOT NULL DEFAULT false,
    "visibleToRecipient" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomProperty_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomProperty_tenantId_idx" ON "CustomProperty"("tenantId");

ALTER TABLE "CustomProperty" ADD CONSTRAINT "CustomProperty_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Order" ADD COLUMN "customFields" JSONB;
