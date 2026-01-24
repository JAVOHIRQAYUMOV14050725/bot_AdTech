-- AlterTable
ALTER TABLE "users" ADD COLUMN     "passwordUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "refreshTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "refreshTokenHash" TEXT;

-- CreateIndex
CREATE INDEX "users_refreshTokenExpiresAt_idx" ON "users"("refreshTokenExpiresAt");
