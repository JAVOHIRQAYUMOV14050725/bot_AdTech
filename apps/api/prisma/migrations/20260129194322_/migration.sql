-- AlterTable
ALTER TABLE "campaign_targets" ALTER COLUMN "price" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "escrows" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "platform_commissions" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(14,2);
