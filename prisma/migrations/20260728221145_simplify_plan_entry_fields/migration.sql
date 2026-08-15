/*
  Warnings:

  - You are about to drop the column `lotNumber` on the `SowingPlanEntry` table. All the data in the column will be lost.
  - You are about to drop the column `productType` on the `SowingPlanEntry` table. All the data in the column will be lost.
  - You are about to drop the column `tunnelId` on the `SowingPlanEntry` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "SowingPlanEntry" DROP CONSTRAINT "SowingPlanEntry_tunnelId_fkey";

-- AlterTable
ALTER TABLE "SowingPlanEntry" DROP COLUMN "lotNumber",
DROP COLUMN "productType",
DROP COLUMN "tunnelId",
ADD COLUMN     "peat" BOOLEAN NOT NULL DEFAULT false;
