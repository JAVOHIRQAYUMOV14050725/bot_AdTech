-- Add missing columns to post_jobs
ALTER TABLE "post_jobs" ADD COLUMN "sendingAt" TIMESTAMP(3);
ALTER TABLE "post_jobs" ADD COLUMN "lastAttemptAt" TIMESTAMP(3);
ALTER TABLE "post_jobs" ADD COLUMN "telegramMessageId" BIGINT;

-- Add index for recovery scans
CREATE INDEX "post_jobs_status_sendingAt_idx" ON "post_jobs"("status", "sendingAt");
