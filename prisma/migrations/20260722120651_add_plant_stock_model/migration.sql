-- AlterTable
ALTER TABLE "Sowing" ADD COLUMN     "numberOfTrays" INTEGER,
ADD COLUMN     "seedsPerTray" INTEGER;

-- CreateTable
CREATE TABLE "PlantStock" (
    "id" TEXT NOT NULL,
    "sowingId" TEXT NOT NULL,
    "cropType" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "stockType" TEXT NOT NULL,
    "numberOfTrays" INTEGER,
    "seedsPerTray" INTEGER,
    "expectedPlants" INTEGER NOT NULL,
    "currentStage" TEXT NOT NULL DEFAULT 'SEEDLING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlantStock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlantStock_sowingId_key" ON "PlantStock"("sowingId");

-- CreateIndex
CREATE INDEX "PlantStock_location_idx" ON "PlantStock"("location");

-- CreateIndex
CREATE INDEX "PlantStock_cropType_idx" ON "PlantStock"("cropType");

-- AddForeignKey
ALTER TABLE "PlantStock" ADD CONSTRAINT "PlantStock_sowingId_fkey" FOREIGN KEY ("sowingId") REFERENCES "Sowing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
