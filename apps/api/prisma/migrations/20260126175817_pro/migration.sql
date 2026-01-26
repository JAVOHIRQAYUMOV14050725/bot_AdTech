/*
  Warnings:

  - You are about to drop the `channel_verification` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "channel_verification" DROP CONSTRAINT "channel_verification_channelId_fkey";

-- DropForeignKey
ALTER TABLE "channel_verification" DROP CONSTRAINT "channel_verification_verifiedBy_fkey";

-- DropTable
DROP TABLE "channel_verification";

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

-- CreateIndex
CREATE UNIQUE INDEX "ChannelVerification_channelId_key" ON "ChannelVerification"("channelId");

-- AddForeignKey
ALTER TABLE "ChannelVerification" ADD CONSTRAINT "ChannelVerification_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelVerification" ADD CONSTRAINT "ChannelVerification_verifiedBy_fkey" FOREIGN KEY ("verifiedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
