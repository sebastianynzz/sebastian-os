-- Tier 3 §13: facturación de la suscripción SaaS — perfil de facturación del
-- tenant + historial de facturas (las emite la plataforma; MoveOS no procesa
-- pagos en la app). Aditiva: columnas nullable + tabla nueva; segura para
-- `prisma migrate deploy`.

ALTER TABLE "Tenant" ADD COLUMN "legalName" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "billingEmail" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "billingAddress" TEXT;

CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "amountCop" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Invoice_tenantId_number_key" ON "Invoice"("tenantId", "number");
CREATE INDEX "Invoice_tenantId_idx" ON "Invoice"("tenantId");

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
