/*
  Warnings:

  - A unique constraint covering the columns `[provider,providerInvoiceId]` on the table `payment_intents` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[provider,providerTxnId]` on the table `payment_intents` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[provider,providerPayoutId]` on the table `withdrawal_intents` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[provider,providerTxnId]` on the table `withdrawal_intents` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateTable
CREATE TABLE "user_invites" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_invites_tokenHash_key" ON "user_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "user_invites_userId_createdAt_idx" ON "user_invites"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "user_invites_expiresAt_idx" ON "user_invites"("expiresAt");

-- CreateIndex
CREATE INDEX "user_invites_usedAt_idx" ON "user_invites"("usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_provider_providerInvoiceId_key" ON "payment_intents"("provider", "providerInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_provider_providerTxnId_key" ON "payment_intents"("provider", "providerTxnId");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_intents_provider_providerPayoutId_key" ON "withdrawal_intents"("provider", "providerPayoutId");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_intents_provider_providerTxnId_key" ON "withdrawal_intents"("provider", "providerTxnId");

-- AddForeignKey
ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
