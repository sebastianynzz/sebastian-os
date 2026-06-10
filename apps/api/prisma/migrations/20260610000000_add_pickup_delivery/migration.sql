-- DropIndex
DROP INDEX "RouteStop_orderId_key";

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "pickedUpAt" TIMESTAMP(3),
ADD COLUMN     "pickupAddressRaw" TEXT,
ADD COLUMN     "pickupLat" DOUBLE PRECISION,
ADD COLUMN     "pickupLng" DOUBLE PRECISION,
ADD COLUMN     "pickupNotes" TEXT;

-- AlterTable
ALTER TABLE "RouteStop" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'DELIVERY';

-- CreateIndex
CREATE UNIQUE INDEX "RouteStop_routeId_orderId_kind_key" ON "RouteStop"("routeId", "orderId", "kind");

