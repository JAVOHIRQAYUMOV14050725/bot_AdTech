-- AlterTable
ALTER TABLE "wallets" ADD COLUMN "systemKey" TEXT,
ADD COLUMN "userId_new" TEXT;

UPDATE "wallets" SET "userId_new" = "userId";

ALTER TABLE "wallets" DROP CONSTRAINT "wallets_userId_fkey";
ALTER TABLE "wallets" DROP CONSTRAINT "wallets_userId_key";
ALTER TABLE "wallets" DROP COLUMN "userId";
ALTER TABLE "wallets" RENAME COLUMN "userId_new" TO "userId";

ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "wallets_userId_key" ON "wallets"("userId");
CREATE UNIQUE INDEX "wallets_systemKey_key" ON "wallets"("systemKey");

-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN "groupId" TEXT;

-- CreateIndex
CREATE INDEX "ledger_entries_groupId_idx" ON "ledger_entries"("groupId");
