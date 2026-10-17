-- AlterTable
ALTER TABLE "PlantCount" ADD COLUMN     "scopeSize" INTEGER,
ADD COLUMN     "seedsInScope" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "PlantCountSample" (
    "id" TEXT NOT NULL,
    "plantCountId" TEXT NOT NULL,
    "line" INTEGER,
    "countedPlants" INTEGER NOT NULL,
    "missingPlants" INTEGER,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlantCountSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlantCountSample_plantCountId_idx" ON "PlantCountSample"("plantCountId");

-- AddForeignKey
ALTER TABLE "PlantCountSample" ADD CONSTRAINT "PlantCountSample_plantCountId_fkey" FOREIGN KEY ("plantCountId") REFERENCES "PlantCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
