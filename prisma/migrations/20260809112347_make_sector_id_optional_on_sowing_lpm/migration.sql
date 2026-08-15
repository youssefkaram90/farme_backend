-- DropForeignKey
ALTER TABLE "SowingLPM" DROP CONSTRAINT "SowingLPM_sectorId_fkey";

-- AlterTable
ALTER TABLE "SowingLPM" ALTER COLUMN "sectorId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "SowingLPM" ADD CONSTRAINT "SowingLPM_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;
