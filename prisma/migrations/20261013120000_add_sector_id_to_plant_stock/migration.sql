-- AlterTable
ALTER TABLE "PlantStock" ADD COLUMN     "sectorId" TEXT;

-- Backfill existing LPM batches through the sowing row. This is exact: the
-- sowing already owns the sector id, so no sector name matching is involved.
UPDATE "PlantStock" ps
SET "sectorId" = lpm."sectorId"
FROM "SowingLPM" lpm
WHERE ps."lpmSowingId" = lpm."id"
  AND lpm."sectorId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "PlantStock_sectorId_idx" ON "PlantStock"("sectorId");

-- AddForeignKey
ALTER TABLE "PlantStock" ADD CONSTRAINT "PlantStock_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;
