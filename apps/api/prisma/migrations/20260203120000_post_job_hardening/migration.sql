-- AlterTable
ALTER TABLE "post_jobs"
ADD COLUMN     "sendingAt" TIMESTAMP(3),
ADD COLUMN     "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "telegramMessageId" BIGINT;

-- CreateIndex
CREATE INDEX "post_jobs_status_sendingAt_idx" ON "post_jobs"("status", "sendingAt");
