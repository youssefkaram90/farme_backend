/*
  Warnings:

  - You are about to drop the column `productId` on the `CropCarePlanEntry` table. All the data in the column will be lost.
  - You are about to drop the column `productId` on the `CropOperation` table. All the data in the column will be lost.
  - You are about to drop the column `productId` on the `PhytosanitaryProgramEntry` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[programId,inputSeasonId]` on the table `PhytosanitaryProgramEntry` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `inputSeasonId` to the `PhytosanitaryProgramEntry` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "CropCarePlanEntry" DROP CONSTRAINT "CropCarePlanEntry_productId_fkey";

-- DropForeignKey
ALTER TABLE "CropOperation" DROP CONSTRAINT "CropOperation_productId_fkey";

-- DropForeignKey
ALTER TABLE "PhytosanitaryProgramEntry" DROP CONSTRAINT "PhytosanitaryProgramEntry_productId_fkey";

-- DropIndex
DROP INDEX "CropOperation_productId_idx";

-- DropIndex
DROP INDEX "PhytosanitaryProgramEntry_programId_productId_key";

-- AlterTable
ALTER TABLE "CropCarePlanEntry" DROP COLUMN "productId",
ADD COLUMN     "inputSeasonId" TEXT;

-- AlterTable
ALTER TABLE "CropOperation" DROP COLUMN "productId",
ADD COLUMN     "inputSeasonId" TEXT;

-- AlterTable
ALTER TABLE "PhytosanitaryProgramEntry" DROP COLUMN "productId",
ADD COLUMN     "inputSeasonId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "CropOperation_inputSeasonId_idx" ON "CropOperation"("inputSeasonId");

-- CreateIndex
CREATE UNIQUE INDEX "PhytosanitaryProgramEntry_programId_inputSeasonId_key" ON "PhytosanitaryProgramEntry"("programId", "inputSeasonId");

-- AddForeignKey
ALTER TABLE "PhytosanitaryProgramEntry" ADD CONSTRAINT "PhytosanitaryProgramEntry_inputSeasonId_fkey" FOREIGN KEY ("inputSeasonId") REFERENCES "AgriInputSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CropCarePlanEntry" ADD CONSTRAINT "CropCarePlanEntry_inputSeasonId_fkey" FOREIGN KEY ("inputSeasonId") REFERENCES "AgriInputSeason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CropOperation" ADD CONSTRAINT "CropOperation_inputSeasonId_fkey" FOREIGN KEY ("inputSeasonId") REFERENCES "AgriInputSeason"("id") ON DELETE SET NULL ON UPDATE CASCADE;
