-- CreateEnum
CREATE TYPE "AdDealStatus" AS ENUM ('created', 'funded', 'escrow_locked', 'accepted', 'proof_submitted', 'settled', 'refunded', 'disputed');

-- CreateEnum
CREATE TYPE "AdDealEscrowStatus" AS ENUM ('locked', 'settled', 'refunded');

-- CreateTable
CREATE TABLE "ad_deals" (
    "id" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "publisherId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "AdDealStatus" NOT NULL DEFAULT 'created',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fundedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "proofSubmittedAt" TIMESTAMP(3),
    "proofPayload" JSONB,
    "settledAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "disputedAt" TIMESTAMP(3),

    CONSTRAINT "ad_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_deal_funding_events" (
    "id" TEXT NOT NULL,
    "adDealId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerReference" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_deal_funding_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_deal_escrows" (
    "id" TEXT NOT NULL,
    "adDealId" TEXT NOT NULL,
    "advertiserWalletId" TEXT NOT NULL,
    "publisherWalletId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "AdDealEscrowStatus" NOT NULL DEFAULT 'locked',
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "ad_deal_escrows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ad_deals_advertiserId_idx" ON "ad_deals"("advertiserId");

-- CreateIndex
CREATE INDEX "ad_deals_publisherId_idx" ON "ad_deals"("publisherId");

-- CreateIndex
CREATE INDEX "ad_deal_funding_events_adDealId_idx" ON "ad_deal_funding_events"("adDealId");

-- CreateIndex
CREATE UNIQUE INDEX "ad_deal_funding_events_providerReference_key" ON "ad_deal_funding_events"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "ad_deal_escrows_adDealId_key" ON "ad_deal_escrows"("adDealId");

-- CreateIndex
CREATE INDEX "ad_deal_escrows_advertiserWalletId_idx" ON "ad_deal_escrows"("advertiserWalletId");

-- CreateIndex
CREATE INDEX "ad_deal_escrows_publisherWalletId_idx" ON "ad_deal_escrows"("publisherWalletId");

-- AddForeignKey
ALTER TABLE "ad_deals" ADD CONSTRAINT "ad_deals_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_deals" ADD CONSTRAINT "ad_deals_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_deal_funding_events" ADD CONSTRAINT "ad_deal_funding_events_adDealId_fkey" FOREIGN KEY ("adDealId") REFERENCES "ad_deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_deal_escrows" ADD CONSTRAINT "ad_deal_escrows_adDealId_fkey" FOREIGN KEY ("adDealId") REFERENCES "ad_deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_deal_escrows" ADD CONSTRAINT "ad_deal_escrows_advertiserWalletId_fkey" FOREIGN KEY ("advertiserWalletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_deal_escrows" ADD CONSTRAINT "ad_deal_escrows_publisherWalletId_fkey" FOREIGN KEY ("publisherWalletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
