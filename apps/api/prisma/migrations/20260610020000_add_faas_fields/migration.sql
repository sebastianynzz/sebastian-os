-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "operatorType" TEXT NOT NULL DEFAULT 'SELF_SERVE',
ADD COLUMN     "parentTenantId" TEXT;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "ownerTenantId" TEXT;

