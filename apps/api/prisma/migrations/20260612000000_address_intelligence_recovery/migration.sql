-- Inteligencia de direcciones + recuperación B2B de entregas fallidas.

-- Order: confianza del geocodificado, confirmación humana del pin y
-- recuperación de entregas fallidas (flag → reprogramación del comercio).
ALTER TABLE "Order" ADD COLUMN "geoConfidence" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "addressVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "recoveryStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "Order" ADD COLUMN "rescheduledFromId" TEXT;

-- AddressPin: ciudad (cobertura del flywheel) y createdAt (crecimiento).
ALTER TABLE "AddressPin" ADD COLUMN "city" TEXT;
ALTER TABLE "AddressPin" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "AddressPin_tenantId_createdAt_idx" ON "AddressPin"("tenantId", "createdAt");

-- Contador diario de geocodificaciones por fuente (graph hit rate).
CREATE TABLE "GeocodeDailyStat" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GeocodeDailyStat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GeocodeDailyStat_tenantId_date_source_key" ON "GeocodeDailyStat"("tenantId", "date", "source");
CREATE INDEX "GeocodeDailyStat_date_idx" ON "GeocodeDailyStat"("date");
