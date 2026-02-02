-- CreateTable
CREATE TABLE "telegram_sessions" (
    "telegramId" BIGINT NOT NULL,
    "state" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_sessions_pkey" PRIMARY KEY ("telegramId")
);

-- CreateIndex
CREATE INDEX "telegram_sessions_updatedAt_idx" ON "telegram_sessions"("updatedAt");
