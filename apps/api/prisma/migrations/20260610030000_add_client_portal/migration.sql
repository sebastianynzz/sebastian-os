-- AlterTable
ALTER TABLE "User" ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "pickupAddressRaw" TEXT,
ADD COLUMN     "pickupLat" DOUBLE PRECISION,
ADD COLUMN     "pickupLng" DOUBLE PRECISION,
ADD COLUMN     "pickupNotes" TEXT;

-- CreateIndex
CREATE INDEX "User_clientId_idx" ON "User"("clientId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

