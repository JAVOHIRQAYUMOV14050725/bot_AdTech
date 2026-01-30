/*
  Warnings:

  - A unique constraint covering the columns `[idempotencyKey]` on the table `financial_audit_events` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[idempotencyKey]` on the table `post_execution_logs` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `idempotencyKey` to the `financial_audit_events` table without a default value. This is not possible if the table is not empty.
  - Made the column `idempotencyKey` on table `ledger_entries` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `idempotencyKey` to the `post_execution_logs` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('pending', 'processing', 'completed');

-- AlterTable
ALTER TABLE "financial_audit_events" ADD COLUMN     "idempotencyKey" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ledger_entries" ALTER COLUMN "idempotencyKey" SET NOT NULL;

-- AlterTable
ALTER TABLE "post_execution_logs" ADD COLUMN     "idempotencyKey" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_dedupeKey_key" ON "outbox_events"("dedupeKey");

-- CreateIndex
CREATE INDEX "outbox_events_status_createdAt_idx" ON "outbox_events"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "financial_audit_events_idempotencyKey_key" ON "financial_audit_events"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "post_execution_logs_idempotencyKey_key" ON "post_execution_logs"("idempotencyKey");
