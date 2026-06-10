-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "trackingToken" TEXT;

-- Backfill: los pedidos existentes reciben un token único (md5 del id, que ya
-- es único). Sin extensiones; URL-safe. Los pedidos nuevos generan base64url.
UPDATE "Order" SET "trackingToken" = md5("id") WHERE "trackingToken" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Order_trackingToken_key" ON "Order"("trackingToken");
