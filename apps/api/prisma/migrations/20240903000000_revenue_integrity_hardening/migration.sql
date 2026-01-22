DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'killswitchkey') THEN
        CREATE TYPE "KillSwitchKey" AS ENUM (
            'payouts',
            'new_escrows',
            'telegram_posting',
            'worker_post',
            'worker_reconciliation',
            'worker_watchdogs'
        );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "financial_audit_events" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS "financial_audit_events_walletId_createdAt_idx"
    ON "financial_audit_events"("walletId", "createdAt");
CREATE INDEX IF NOT EXISTS "financial_audit_events_campaignId_createdAt_idx"
    ON "financial_audit_events"("campaignId", "createdAt");
CREATE INDEX IF NOT EXISTS "financial_audit_events_campaignTargetId_createdAt_idx"
    ON "financial_audit_events"("campaignTargetId", "createdAt");

CREATE TABLE IF NOT EXISTS "kill_switches" (
    "key" "KillSwitchKey" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kill_switches_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "kill_switch_events" (
    "id" TEXT NOT NULL,
    "key" "KillSwitchKey" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "reason" TEXT,
    "updatedBy" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kill_switch_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "kill_switch_events_key_createdAt_idx"
    ON "kill_switch_events"("key", "createdAt");

DO $$\nBEGIN\n    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_audit_events_walletId_fkey') THEN\n        ALTER TABLE \"financial_audit_events\"\n            ADD CONSTRAINT \"financial_audit_events_walletId_fkey\"\n            FOREIGN KEY (\"walletId\") REFERENCES \"wallets\"(\"id\") ON DELETE RESTRICT ON UPDATE CASCADE;\n    END IF;\n\n    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_audit_events_ledgerEntryId_fkey') THEN\n        ALTER TABLE \"financial_audit_events\"\n            ADD CONSTRAINT \"financial_audit_events_ledgerEntryId_fkey\"\n            FOREIGN KEY (\"ledgerEntryId\") REFERENCES \"ledger_entries\"(\"id\") ON DELETE SET NULL ON UPDATE CASCADE;\n    END IF;\n\n    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_audit_events_campaignId_fkey') THEN\n        ALTER TABLE \"financial_audit_events\"\n            ADD CONSTRAINT \"financial_audit_events_campaignId_fkey\"\n            FOREIGN KEY (\"campaignId\") REFERENCES \"campaigns\"(\"id\") ON DELETE SET NULL ON UPDATE CASCADE;\n    END IF;\n\n    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_audit_events_campaignTargetId_fkey') THEN\n        ALTER TABLE \"financial_audit_events\"\n            ADD CONSTRAINT \"financial_audit_events_campaignTargetId_fkey\"\n            FOREIGN KEY (\"campaignTargetId\") REFERENCES \"campaign_targets\"(\"id\") ON DELETE SET NULL ON UPDATE CASCADE;\n    END IF;\n\n    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_audit_events_escrowId_fkey') THEN\n        ALTER TABLE \"financial_audit_events\"\n            ADD CONSTRAINT \"financial_audit_events_escrowId_fkey\"\n            FOREIGN KEY (\"escrowId\") REFERENCES \"escrows\"(\"id\") ON DELETE SET NULL ON UPDATE CASCADE;\n    END IF;\n\n    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kill_switch_events_key_fkey') THEN\n        ALTER TABLE \"kill_switch_events\"\n            ADD CONSTRAINT \"kill_switch_events_key_fkey\"\n            FOREIGN KEY (\"key\") REFERENCES \"kill_switches\"(\"key\") ON DELETE CASCADE ON UPDATE CASCADE;\n    END IF;\n\n    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wallets_balance_non_negative') THEN\n        ALTER TABLE \"wallets\"\n            ADD CONSTRAINT \"wallets_balance_non_negative\"\n            CHECK (\"balance\" >= 0);\n    END IF;\nEND $$;