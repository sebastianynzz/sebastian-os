-- D3: servicios / SLA (promesa de entrega con precio por parada + plazo).
-- Aditiva: tabla nueva + columna/FK nullable (segura para `prisma migrate deploy`).

CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "pricePerStopCop" INTEGER NOT NULL DEFAULT 0,
    "completionDeadlineMin" INTEGER NOT NULL,
    "cutoffTime" TEXT,
    "serviceDays" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stopType" TEXT NOT NULL DEFAULT 'DELIVERY',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Service_tenantId_identifier_key" ON "Service"("tenantId", "identifier");
CREATE INDEX "Service_tenantId_idx" ON "Service"("tenantId");

ALTER TABLE "Order" ADD COLUMN "serviceId" TEXT;
ALTER TABLE "Order" ADD CONSTRAINT "Order_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;
