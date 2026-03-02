/*
  Warnings:

  - A unique constraint covering the columns `[systemKey]` on the table `wallets` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "wallets" DROP CONSTRAINT "wallets_userId_fkey";

-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN     "groupId" TEXT;

-- AlterTable
ALTER TABLE "wallets" ADD COLUMN     "systemKey" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "ledger_entries_groupId_idx" ON "ledger_entries"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_systemKey_key" ON "wallets"("systemKey");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
