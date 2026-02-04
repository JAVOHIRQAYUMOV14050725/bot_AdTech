-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('super_admin', 'admin', 'moderator', 'advertiser', 'publisher');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'pending_telegram_link', 'suspended', 'banned');

-- CreateEnum
CREATE TYPE "ChannelStatus" AS ENUM ('pending', 'verified', 'approved', 'rejected', 'blocked');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'active', 'paused', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "CampaignTargetStatus" AS ENUM ('pending', 'submitted', 'accepted', 'approved', 'rejected', 'posted', 'failed', 'refunded');

-- CreateEnum
CREATE TYPE "CreativeType" AS ENUM ('text', 'image', 'video');

-- CreateEnum
CREATE TYPE "PostJobStatus" AS ENUM ('queued', 'sending', 'success', 'failed');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('debit', 'credit');

-- CreateEnum
CREATE TYPE "LedgerReason" AS ENUM ('deposit', 'escrow_hold', 'payout', 'commission', 'refund', 'withdrawal');

-- CreateEnum
CREATE TYPE "EscrowStatus" AS ENUM ('held', 'releasing', 'released', 'refunding', 'refunded');

-- CreateEnum
CREATE TYPE "AdDealStatus" AS ENUM ('created', 'funded', 'escrow_locked', 'accepted', 'proof_submitted', 'settled', 'refunded', 'disputed');

-- CreateEnum
CREATE TYPE "AdDealEscrowStatus" AS ENUM ('locked', 'settled', 'refunded');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('open', 'resolved');

-- CreateEnum
CREATE TYPE "DisputeResolution" AS ENUM ('release', 'refund');

-- CreateEnum
CREATE TYPE "KillSwitchKey" AS ENUM ('payouts', 'new_escrows', 'telegram_posting', 'worker_post', 'worker_reconciliation', 'worker_watchdogs');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('pending', 'processing', 'completed');

-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('pending', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "WithdrawalIntentStatus" AS ENUM ('pending', 'processing', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "SystemActionType" AS ENUM ('FORCE_RELEASE', 'FORCE_REFUND', 'MANUAL_RESOLVE');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT,
    "username" TEXT,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "refreshTokenHash" TEXT,
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "passwordUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "user_audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_sessions" (
    "telegramId" BIGINT NOT NULL,
    "state" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_sessions_pkey" PRIMARY KEY ("telegramId")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" TEXT NOT NULL,
    "telegramChannelId" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "username" TEXT,
    "category" TEXT,
    "subscriberCount" INTEGER NOT NULL DEFAULT 0,
    "avgViews" INTEGER NOT NULL DEFAULT 0,
    "cpm" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" "ChannelStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_stats_daily" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "subscribers" INTEGER,
    "views" INTEGER,
    "engagementRate" DECIMAL(5,2),

    CONSTRAINT "channel_stats_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelVerification" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "verifiedBy" TEXT,
    "fraudScore" INTEGER NOT NULL,
    "notes" TEXT,
    "lastError" TEXT,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_channel_signals" (
    "id" TEXT NOT NULL,
    "telegramChannelId" BIGINT NOT NULL,
    "title" TEXT,
    "username" TEXT,
    "source" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_channel_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "totalBudget" DECIMAL(14,2) NOT NULL,
    "spentBudget" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_targets" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "CampaignTargetStatus" NOT NULL DEFAULT 'pending',
    "moderatedBy" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "moderationReason" TEXT,

    CONSTRAINT "campaign_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_deals" (
    "id" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "publisherId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "AdDealStatus" NOT NULL DEFAULT 'created',
    "commissionPercentage" DECIMAL(5,2),
    "commissionAmount" DECIMAL(14,2),
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

-- CreateTable
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "adDealId" TEXT NOT NULL,
    "openedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'open',
    "resolution" "DisputeResolution",
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_audit_logs" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_creatives" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contentType" "CreativeType" NOT NULL,
    "contentPayload" JSONB NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "ad_creatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_jobs" (
    "id" TEXT NOT NULL,
    "campaignTargetId" TEXT NOT NULL,
    "executeAt" TIMESTAMP(3) NOT NULL,
    "sendingAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "telegramMessageId" BIGINT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "status" "PostJobStatus" NOT NULL DEFAULT 'queued',
    "lastError" TEXT,

    CONSTRAINT "post_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_execution_logs" (
    "id" TEXT NOT NULL,
    "postJobId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "telegramMessageId" BIGINT,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responsePayload" JSONB,

    CONSTRAINT "post_execution_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "LedgerType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" "LedgerReason" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escrows" (
    "id" TEXT NOT NULL,
    "campaignTargetId" TEXT NOT NULL,
    "advertiserWalletId" TEXT NOT NULL,
    "publisherWalletId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "EscrowStatus" NOT NULL DEFAULT 'held',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "escrows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_commissions" (
    "id" TEXT NOT NULL,
    "campaignTargetId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_audit_events" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "ledgerEntryId" TEXT,
    "campaignId" TEXT,
    "campaignTargetId" TEXT,
    "escrowId" TEXT,
    "type" "LedgerType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" "LedgerReason" NOT NULL,
    "actor" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "provider" TEXT NOT NULL,
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'pending',
    "idempotencyKey" TEXT NOT NULL,
    "providerInvoiceId" TEXT,
    "providerTxnId" TEXT,
    "paymentUrl" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "succeededAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_intents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "provider" TEXT NOT NULL,
    "status" "WithdrawalIntentStatus" NOT NULL DEFAULT 'pending',
    "idempotencyKey" TEXT NOT NULL,
    "providerPayoutId" TEXT,
    "providerTxnId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "processingAt" TIMESTAMP(3),
    "succeededAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "withdrawal_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemActionLog" (
    "id" TEXT NOT NULL,
    "action" "SystemActionType" NOT NULL,
    "escrowId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kill_switches" (
    "key" "KillSwitchKey" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kill_switches_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "kill_switch_events" (
    "id" TEXT NOT NULL,
    "key" "KillSwitchKey" NOT NULL,
    "previousEnabled" BOOLEAN,
    "newEnabled" BOOLEAN NOT NULL,
    "actor" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kill_switch_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_telegramId_key" ON "users"("telegramId");

-- CreateIndex
CREATE INDEX "users_telegramId_idx" ON "users"("telegramId");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_refreshTokenExpiresAt_idx" ON "users"("refreshTokenExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_invites_tokenHash_key" ON "user_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "user_invites_userId_createdAt_idx" ON "user_invites"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "user_invites_expiresAt_idx" ON "user_invites"("expiresAt");

-- CreateIndex
CREATE INDEX "user_invites_usedAt_idx" ON "user_invites"("usedAt");

-- CreateIndex
CREATE INDEX "user_audit_logs_userId_idx" ON "user_audit_logs"("userId");

-- CreateIndex
CREATE INDEX "telegram_sessions_updatedAt_idx" ON "telegram_sessions"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "channels_telegramChannelId_key" ON "channels"("telegramChannelId");

-- CreateIndex
CREATE INDEX "channels_ownerId_idx" ON "channels"("ownerId");

-- CreateIndex
CREATE INDEX "channels_status_idx" ON "channels"("status");

-- CreateIndex
CREATE UNIQUE INDEX "channel_stats_daily_channelId_date_key" ON "channel_stats_daily"("channelId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelVerification_channelId_key" ON "ChannelVerification"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_channel_signals_telegramChannelId_key" ON "telegram_channel_signals"("telegramChannelId");

-- CreateIndex
CREATE INDEX "telegram_channel_signals_receivedAt_idx" ON "telegram_channel_signals"("receivedAt");

-- CreateIndex
CREATE INDEX "campaigns_advertiserId_idx" ON "campaigns"("advertiserId");

-- CreateIndex
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");

-- CreateIndex
CREATE INDEX "campaign_targets_campaignId_idx" ON "campaign_targets"("campaignId");

-- CreateIndex
CREATE INDEX "campaign_targets_scheduledAt_idx" ON "campaign_targets"("scheduledAt");

-- CreateIndex
CREATE INDEX "ad_deals_advertiserId_idx" ON "ad_deals"("advertiserId");

-- CreateIndex
CREATE INDEX "ad_deals_publisherId_idx" ON "ad_deals"("publisherId");

-- CreateIndex
CREATE UNIQUE INDEX "ad_deal_funding_events_providerReference_key" ON "ad_deal_funding_events"("providerReference");

-- CreateIndex
CREATE INDEX "ad_deal_funding_events_adDealId_idx" ON "ad_deal_funding_events"("adDealId");

-- CreateIndex
CREATE UNIQUE INDEX "ad_deal_escrows_adDealId_key" ON "ad_deal_escrows"("adDealId");

-- CreateIndex
CREATE INDEX "ad_deal_escrows_advertiserWalletId_idx" ON "ad_deal_escrows"("advertiserWalletId");

-- CreateIndex
CREATE INDEX "ad_deal_escrows_publisherWalletId_idx" ON "ad_deal_escrows"("publisherWalletId");

-- CreateIndex
CREATE UNIQUE INDEX "disputes_adDealId_key" ON "disputes"("adDealId");

-- CreateIndex
CREATE INDEX "disputes_openedBy_idx" ON "disputes"("openedBy");

-- CreateIndex
CREATE INDEX "disputes_status_idx" ON "disputes"("status");

-- CreateIndex
CREATE INDEX "dispute_audit_logs_disputeId_idx" ON "dispute_audit_logs"("disputeId");

-- CreateIndex
CREATE INDEX "dispute_audit_logs_adminId_idx" ON "dispute_audit_logs"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "post_jobs_campaignTargetId_key" ON "post_jobs"("campaignTargetId");

-- CreateIndex
CREATE INDEX "post_jobs_executeAt_status_idx" ON "post_jobs"("executeAt", "status");

-- CreateIndex
CREATE INDEX "post_jobs_status_sendingAt_idx" ON "post_jobs"("status", "sendingAt");

-- CreateIndex
CREATE UNIQUE INDEX "post_execution_logs_idempotencyKey_key" ON "post_execution_logs"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_dedupeKey_key" ON "outbox_events"("dedupeKey");

-- CreateIndex
CREATE INDEX "outbox_events_status_createdAt_idx" ON "outbox_events"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_key" ON "wallets"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_idempotencyKey_key" ON "ledger_entries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ledger_entries_walletId_idx" ON "ledger_entries"("walletId");

-- CreateIndex
CREATE UNIQUE INDEX "escrows_campaignTargetId_key" ON "escrows"("campaignTargetId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_commissions_campaignTargetId_key" ON "platform_commissions"("campaignTargetId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_audit_events_idempotencyKey_key" ON "financial_audit_events"("idempotencyKey");

-- CreateIndex
CREATE INDEX "financial_audit_events_walletId_createdAt_idx" ON "financial_audit_events"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "financial_audit_events_campaignId_createdAt_idx" ON "financial_audit_events"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "financial_audit_events_campaignTargetId_createdAt_idx" ON "financial_audit_events"("campaignTargetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_idempotencyKey_key" ON "payment_intents"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payment_intents_userId_createdAt_idx" ON "payment_intents"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "payment_intents_status_createdAt_idx" ON "payment_intents"("status", "createdAt");

-- CreateIndex
CREATE INDEX "payment_intents_provider_providerInvoiceId_idx" ON "payment_intents"("provider", "providerInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_provider_providerInvoiceId_key" ON "payment_intents"("provider", "providerInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_provider_providerTxnId_key" ON "payment_intents"("provider", "providerTxnId");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_intents_idempotencyKey_key" ON "withdrawal_intents"("idempotencyKey");

-- CreateIndex
CREATE INDEX "withdrawal_intents_userId_createdAt_idx" ON "withdrawal_intents"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "withdrawal_intents_status_createdAt_idx" ON "withdrawal_intents"("status", "createdAt");

-- CreateIndex
CREATE INDEX "withdrawal_intents_provider_providerPayoutId_idx" ON "withdrawal_intents"("provider", "providerPayoutId");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_intents_provider_providerPayoutId_key" ON "withdrawal_intents"("provider", "providerPayoutId");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_intents_provider_providerTxnId_key" ON "withdrawal_intents"("provider", "providerTxnId");

-- CreateIndex
CREATE INDEX "SystemActionLog_escrowId_idx" ON "SystemActionLog"("escrowId");

-- CreateIndex
CREATE INDEX "kill_switch_events_key_createdAt_idx" ON "kill_switch_events"("key", "createdAt");

-- AddForeignKey
ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_audit_logs" ADD CONSTRAINT "user_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_stats_daily" ADD CONSTRAINT "channel_stats_daily_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelVerification" ADD CONSTRAINT "ChannelVerification_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelVerification" ADD CONSTRAINT "ChannelVerification_verifiedBy_fkey" FOREIGN KEY ("verifiedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_targets" ADD CONSTRAINT "campaign_targets_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_targets" ADD CONSTRAINT "campaign_targets_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_targets" ADD CONSTRAINT "campaign_targets_moderatedBy_fkey" FOREIGN KEY ("moderatedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_adDealId_fkey" FOREIGN KEY ("adDealId") REFERENCES "ad_deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_openedBy_fkey" FOREIGN KEY ("openedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolvedBy_fkey" FOREIGN KEY ("resolvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_audit_logs" ADD CONSTRAINT "dispute_audit_logs_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "disputes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_audit_logs" ADD CONSTRAINT "dispute_audit_logs_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_jobs" ADD CONSTRAINT "post_jobs_campaignTargetId_fkey" FOREIGN KEY ("campaignTargetId") REFERENCES "campaign_targets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_execution_logs" ADD CONSTRAINT "post_execution_logs_postJobId_fkey" FOREIGN KEY ("postJobId") REFERENCES "post_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_campaignTargetId_fkey" FOREIGN KEY ("campaignTargetId") REFERENCES "campaign_targets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_advertiserWalletId_fkey" FOREIGN KEY ("advertiserWalletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_publisherWalletId_fkey" FOREIGN KEY ("publisherWalletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_commissions" ADD CONSTRAINT "platform_commissions_campaignTargetId_fkey" FOREIGN KEY ("campaignTargetId") REFERENCES "campaign_targets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_audit_events" ADD CONSTRAINT "financial_audit_events_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_audit_events" ADD CONSTRAINT "financial_audit_events_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_audit_events" ADD CONSTRAINT "financial_audit_events_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_audit_events" ADD CONSTRAINT "financial_audit_events_campaignTargetId_fkey" FOREIGN KEY ("campaignTargetId") REFERENCES "campaign_targets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_audit_events" ADD CONSTRAINT "financial_audit_events_escrowId_fkey" FOREIGN KEY ("escrowId") REFERENCES "escrows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_intents" ADD CONSTRAINT "withdrawal_intents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_intents" ADD CONSTRAINT "withdrawal_intents_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kill_switch_events" ADD CONSTRAINT "kill_switch_events_key_fkey" FOREIGN KEY ("key") REFERENCES "kill_switches"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
