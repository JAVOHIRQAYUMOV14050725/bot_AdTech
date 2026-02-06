-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdDealStatus" ADD VALUE 'publisher_requested';
ALTER TYPE "AdDealStatus" ADD VALUE 'publisher_declined';
ALTER TYPE "AdDealStatus" ADD VALUE 'advertiser_confirmed';

-- AlterTable
ALTER TABLE "ad_deals" ADD COLUMN     "advertiserConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "publisherDeclinedAt" TIMESTAMP(3),
ADD COLUMN     "publisherRequestedAt" TIMESTAMP(3);
