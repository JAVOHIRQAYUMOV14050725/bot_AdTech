-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'pending_telegram_link';

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "telegramId" DROP NOT NULL;
