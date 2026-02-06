-- AlterEnum
ALTER TYPE "AdDealStatus" ADD VALUE IF NOT EXISTS 'publisher_requested';
ALTER TYPE "AdDealStatus" ADD VALUE IF NOT EXISTS 'publisher_declined';
ALTER TYPE "AdDealStatus" ADD VALUE IF NOT EXISTS 'advertiser_confirmed';

-- AlterTable
ALTER TABLE "ad_deals"
ADD COLUMN "publisherRequestedAt" TIMESTAMP(3),
ADD COLUMN "publisherDeclinedAt" TIMESTAMP(3),
ADD COLUMN "advertiserConfirmedAt" TIMESTAMP(3);

-- Backfill timestamps for existing records
UPDATE "ad_deals"
SET "publisherRequestedAt" = COALESCE(
        "publisherRequestedAt",
        "lockedAt",
        "acceptedAt",
        "proofSubmittedAt",
        "settledAt",
        "disputedAt"
    )
WHERE "publisherRequestedAt" IS NULL
  AND "status" IN (
    'publisher_requested',
    'publisher_declined',
    'accepted',
    'advertiser_confirmed',
    'proof_submitted',
    'settled',
    'disputed'
  );

UPDATE "ad_deals"
SET "advertiserConfirmedAt" = COALESCE(
        "advertiserConfirmedAt",
        "acceptedAt",
        "proofSubmittedAt",
        "settledAt"
    )
WHERE "advertiserConfirmedAt" IS NULL
  AND "status" IN (
    'advertiser_confirmed',
    'proof_submitted',
    'settled',
    'disputed'
  );
