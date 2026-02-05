/*
  Warnings:

  - You are about to drop the column `createdAt` on the `telegram_sessions` table. All the data in the column will be lost.
  - You are about to drop the column `payload` on the `telegram_sessions` table. All the data in the column will be lost.
  - You are about to drop the column `state` on the `telegram_sessions` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `telegram_sessions` table. All the data in the column will be lost.
  - Added the required column `lastSeenAt` to the `telegram_sessions` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "telegram_sessions_updatedAt_idx";

-- AlterTable
ALTER TABLE "telegram_sessions" DROP COLUMN "createdAt",
DROP COLUMN "payload",
DROP COLUMN "state",
DROP COLUMN "updatedAt",
ADD COLUMN     "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "usernameNormalized" TEXT;

-- AlterTable
ALTER TABLE "user_invites" ADD COLUMN     "boundTelegramId" BIGINT;

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

-- CreateIndex
CREATE INDEX "telegram_sessions_usernameNormalized_idx" ON "telegram_sessions"("usernameNormalized");

-- CreateIndex
CREATE INDEX "telegram_sessions_lastSeenAt_idx" ON "telegram_sessions"("lastSeenAt");
