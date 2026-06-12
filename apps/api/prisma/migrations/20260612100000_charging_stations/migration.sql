-- Directorio de estaciones de carga (núcleo EV, roadmap P0.4b).
-- Aditiva: tabla nueva, sin tocar datos existentes.

-- CreateTable
CREATE TABLE "ChargingStation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT NOT NULL DEFAULT 'Bogotá',
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "connectors" TEXT[],
    "powerKw" DOUBLE PRECISION,
    "dcFast" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChargingStation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChargingStation_city_idx" ON "ChargingStation"("city");

-- CreateIndex
CREATE INDEX "ChargingStation_tenantId_idx" ON "ChargingStation"("tenantId");

-- AddForeignKey
ALTER TABLE "ChargingStation" ADD CONSTRAINT "ChargingStation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
