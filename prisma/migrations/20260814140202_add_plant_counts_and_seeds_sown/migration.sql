-- AlterTable
ALTER TABLE "PlantStock" ADD COLUMN     "seedsSown" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PlantCount" (
    "id" TEXT NOT NULL,
    "plantStockId" TEXT NOT NULL,
    "countType" TEXT NOT NULL,
    "sampleSize" DOUBLE PRECISION NOT NULL,
    "countedPlants" INTEGER NOT NULL,
    "density" DOUBLE PRECISION NOT NULL,
    "estimatedPlants" INTEGER NOT NULL,
    "germinationRate" DOUBLE PRECISION,
    "countDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlantCount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlantCount_plantStockId_idx" ON "PlantCount"("plantStockId");

-- AddForeignKey
ALTER TABLE "PlantCount" ADD CONSTRAINT "PlantCount_plantStockId_fkey" FOREIGN KEY ("plantStockId") REFERENCES "PlantStock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
