/*
  Warnings:

  - A unique constraint covering the columns `[superAdminKey]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "superAdminKey" TEXT;

-- CreateTable
CREATE TABLE "bootstrap_state" (
    "id" INTEGER NOT NULL,
    "bootstrappedAt" TIMESTAMP(3) NOT NULL,
    "superAdminUserId" TEXT NOT NULL,
    "bootstrapTokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bootstrap_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bootstrap_state_superAdminUserId_key" ON "bootstrap_state"("superAdminUserId");

-- CreateIndex
CREATE UNIQUE INDEX "users_superAdminKey_key" ON "users"("superAdminKey");

-- AddForeignKey
ALTER TABLE "bootstrap_state" ADD CONSTRAINT "bootstrap_state_superAdminUserId_fkey" FOREIGN KEY ("superAdminUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
