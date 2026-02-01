/*
  Warnings:

  - You are about to drop the column `enabled` on the `kill_switch_events` table. All the data in the column will be lost.
  - You are about to drop the column `updatedBy` on the `kill_switch_events` table. All the data in the column will be lost.
  - Added the required column `actor` to the `kill_switch_events` table without a default value. This is not possible if the table is not empty.
  - Added the required column `newEnabled` to the `kill_switch_events` table without a default value. This is not possible if the table is not empty.
  - Made the column `reason` on table `kill_switch_events` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "kill_switch_events" DROP COLUMN "enabled",
DROP COLUMN "updatedBy",
ADD COLUMN     "actor" TEXT NOT NULL,
ADD COLUMN     "newEnabled" BOOLEAN NOT NULL,
ADD COLUMN     "previousEnabled" BOOLEAN,
ALTER COLUMN "reason" SET NOT NULL;
