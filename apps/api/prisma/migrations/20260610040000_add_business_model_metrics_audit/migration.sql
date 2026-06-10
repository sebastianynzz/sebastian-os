-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "businessModel" TEXT NOT NULL DEFAULT 'SAAS';

-- CreateTable
CREATE TABLE "DailyTenantMetric" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "ordersCreated" INTEGER NOT NULL DEFAULT 0,
    "ordersDelivered" INTEGER NOT NULL DEFAULT 0,
    "ordersFailed" INTEGER NOT NULL DEFAULT 0,
    "routesPlanned" INTEGER NOT NULL DEFAULT 0,
    "stopsCompleted" INTEGER NOT NULL DEFAULT 0,
    "totalDistanceKm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalDurationMin" INTEGER NOT NULL DEFAULT 0,
    "activeDrivers" INTEGER NOT NULL DEFAULT 0,
    "co2Kg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "co2SavedKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyTenantMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAuditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "adminEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetTenantId" TEXT,
    "targetUserId" TEXT,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyTenantMetric_date_idx" ON "DailyTenantMetric"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyTenantMetric_tenantId_date_key" ON "DailyTenantMetric"("tenantId", "date");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_targetTenantId_createdAt_idx" ON "PlatformAuditLog"("targetTenantId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_createdAt_idx" ON "PlatformAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "DailyTenantMetric" ADD CONSTRAINT "DailyTenantMetric_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

