-- DropIndex
DROP INDEX "SowingLPM_planEntryId_key";

-- DropIndex
DROP INDEX "SowingSSM_planEntryId_key";

-- AlterTable
ALTER TABLE "SowingPlanEntry" ADD COLUMN     "executedQuantity" INTEGER DEFAULT 0,
ADD COLUMN     "executedTrays" INTEGER DEFAULT 0;
