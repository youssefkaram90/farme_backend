/*
  Warnings:

  - Added the required column `planId` to the `SowingLPM` table without a default value. This is not possible if the table is not empty.
  - Added the required column `planId` to the `SowingSSM` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "SowingLPM" ADD COLUMN     "planId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "SowingSSM" ADD COLUMN     "planId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "SowingLPM_planId_idx" ON "SowingLPM"("planId");

-- CreateIndex
CREATE INDEX "SowingSSM_planId_idx" ON "SowingSSM"("planId");

-- AddForeignKey
ALTER TABLE "SowingSSM" ADD CONSTRAINT "SowingSSM_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SowingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SowingLPM" ADD CONSTRAINT "SowingLPM_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SowingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
