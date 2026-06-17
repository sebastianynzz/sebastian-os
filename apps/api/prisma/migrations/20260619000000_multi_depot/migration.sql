-- D4: multi-depot (depósitos / centros de distribución por tenant).
-- Aditiva: tabla nueva + columnas/FK nullable (segura para `prisma migrate deploy`).

CREATE TABLE "Depot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "routeDefaults" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Depot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Depot_tenantId_idx" ON "Depot"("tenantId");

ALTER TABLE "Depot" ADD CONSTRAINT "Depot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Route" ADD COLUMN "depotId" TEXT;
ALTER TABLE "Route" ADD CONSTRAINT "Route_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Driver" ADD COLUMN "depotId" TEXT;
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Vehicle" ADD COLUMN "homeDepotId" TEXT;
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_homeDepotId_fkey" FOREIGN KEY ("homeDepotId") REFERENCES "Depot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
