/*
  Warnings:

  - A unique constraint covering the columns `[idempotencyKey]` on the table `ad_deals` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "ad_deals" ADD COLUMN     "channelId" TEXT,
ADD COLUMN     "correlationId" TEXT,
ADD COLUMN     "escrowId" TEXT,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "payoutAmount" DECIMAL(14,2);

-- CreateIndex
CREATE UNIQUE INDEX "ad_deals_idempotencyKey_key" ON "ad_deals"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ad_deals_channelId_idx" ON "ad_deals"("channelId");

-- AddForeignKey
ALTER TABLE "ad_deals" ADD CONSTRAINT "ad_deals_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
