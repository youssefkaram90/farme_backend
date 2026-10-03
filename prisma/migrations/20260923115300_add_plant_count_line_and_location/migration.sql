-- AlterTable
ALTER TABLE "PlantCount" ADD COLUMN     "line" INTEGER,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "missingPlants" INTEGER,
ADD COLUMN     "rowsInspected" INTEGER;
