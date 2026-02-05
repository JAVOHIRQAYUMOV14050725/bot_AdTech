-- AlterTable
ALTER TABLE "user_invites" ADD COLUMN "boundTelegramId" BIGINT;

-- AlterTable
ALTER TABLE "telegram_sessions" DROP COLUMN "state";
ALTER TABLE "telegram_sessions" DROP COLUMN "payload";
ALTER TABLE "telegram_sessions" ADD COLUMN "usernameNormalized" TEXT;
ALTER TABLE "telegram_sessions" RENAME COLUMN "createdAt" TO "firstSeenAt";
ALTER TABLE "telegram_sessions" RENAME COLUMN "updatedAt" TO "lastSeenAt";

-- DropIndex
DROP INDEX "telegram_sessions_updatedAt_idx";

-- CreateIndex
CREATE INDEX "telegram_sessions_usernameNormalized_idx" ON "telegram_sessions"("usernameNormalized");

-- CreateIndex
CREATE INDEX "telegram_sessions_lastSeenAt_idx" ON "telegram_sessions"("lastSeenAt");

-- CreateTable
CREATE TABLE "security_audit_logs" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "actorUserId" TEXT,
    "telegramId" BIGINT,
    "metadata" JSONB,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "security_audit_logs_actorUserId_createdAt_idx" ON "security_audit_logs"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "security_audit_logs_telegramId_createdAt_idx" ON "security_audit_logs"("telegramId", "createdAt");

-- CreateIndex
CREATE INDEX "security_audit_logs_event_createdAt_idx" ON "security_audit_logs"("event", "createdAt");
