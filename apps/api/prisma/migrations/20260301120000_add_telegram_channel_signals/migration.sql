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

-- CreateIndex
CREATE UNIQUE INDEX "telegram_channel_signals_telegramChannelId_key" ON "telegram_channel_signals"("telegramChannelId");

-- CreateIndex
CREATE INDEX "telegram_channel_signals_receivedAt_idx" ON "telegram_channel_signals"("receivedAt");
