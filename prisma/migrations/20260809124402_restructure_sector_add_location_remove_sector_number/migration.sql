/*
  Warnings:

  - You are about to drop the column `farmName` on the `Sector` table. All the data in the column will be lost.
  - You are about to drop the column `sectorNumber` on the `SowingLPM` table. All the data in the column will be lost.
  - You are about to drop the column `sectorNumber` on the `SowingPlanEntry` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[location,name]` on the table `Sector` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Sector_name_key";

-- AlterTable
ALTER TABLE "Sector" DROP COLUMN "farmName",
ADD COLUMN     "location" TEXT;

-- AlterTable
ALTER TABLE "SowingLPM" DROP COLUMN "sectorNumber";

-- AlterTable
ALTER TABLE "SowingPlanEntry" DROP COLUMN "sectorNumber";

-- CreateIndex
CREATE UNIQUE INDEX "Sector_location_name_key" ON "Sector"("location", "name");
