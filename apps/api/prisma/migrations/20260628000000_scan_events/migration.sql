-- Tier 2 §11: escaneo de paquetes — cadena de custodia depósito → puerta.
-- ScanEvent por escaneo (LOAD/PICKUP/DELIVER). Aditiva: tabla nueva; segura
-- para `prisma migrate deploy`.

CREATE TABLE "ScanEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT,
    "routeId" TEXT,
    "type" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScanEvent_tenantId_idx" ON "ScanEvent"("tenantId");
CREATE INDEX "ScanEvent_routeId_idx" ON "ScanEvent"("routeId");
CREATE INDEX "ScanEvent_orderId_idx" ON "ScanEvent"("orderId");

ALTER TABLE "ScanEvent" ADD CONSTRAINT "ScanEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScanEvent" ADD CONSTRAINT "ScanEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ScanEvent" ADD CONSTRAINT "ScanEvent_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;
