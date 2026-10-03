/*
  Warnings:

  - You are about to drop the column `metersPerLine` on the `PlantStock` table. All the data in the column will be lost.
  - The `lines` column on the `PlantStock` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `metersPerLine` on the `SowingLPM` table. All the data in the column will be lost.
  - The `lines` column on the `SowingLPM` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `lines` column on the `SowingPlanEntry` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "PlantStock" DROP COLUMN "metersPerLine",
ADD COLUMN     "meterPerLine" INTEGER,
DROP COLUMN "lines",
ADD COLUMN     "lines" INTEGER;

-- AlterTable
ALTER TABLE "SowingLPM" DROP COLUMN "metersPerLine",
ADD COLUMN     "meterPerLine" INTEGER,
DROP COLUMN "lines",
ADD COLUMN     "lines" INTEGER;

-- AlterTable
ALTER TABLE "SowingPlanEntry" DROP COLUMN "lines",
ADD COLUMN     "lines" INTEGER;
