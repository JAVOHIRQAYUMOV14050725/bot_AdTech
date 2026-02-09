ALTER TABLE "ad_deals"
ADD COLUMN "channelId" TEXT,
ADD COLUMN "payoutAmount" DECIMAL(14,2),
ADD COLUMN "escrowId" TEXT,
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "correlationId" TEXT;

CREATE UNIQUE INDEX "ad_deals_idempotencyKey_key" ON "ad_deals"("idempotencyKey");
CREATE INDEX "ad_deals_channelId_idx" ON "ad_deals"("channelId");

ALTER TABLE "ad_deals"
ADD CONSTRAINT "ad_deals_channelId_fkey"
FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
