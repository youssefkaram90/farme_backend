/*
  Warnings:

  - You are about to drop the column `sowingId` on the `PlantStock` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[ssmSowingId]` on the table `PlantStock` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[lpmSowingId]` on the table `PlantStock` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "PlantStock" DROP CONSTRAINT "PlantStock_sowingId_fkey";

-- DropIndex
DROP INDEX "PlantStock_sowingId_key";

-- AlterTable
ALTER TABLE "PlantStock" DROP COLUMN "sowingId",
ADD COLUMN     "lines" TEXT,
ADD COLUMN     "lpmSowingId" TEXT,
ADD COLUMN     "metersPerLine" DOUBLE PRECISION,
ADD COLUMN     "seedsPerMeter" INTEGER,
ADD COLUMN     "ssmSowingId" TEXT;

-- CreateTable
CREATE TABLE "Tunnel" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tunnel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sector" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "farmName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SowingPlan" (
    "id" TEXT NOT NULL,
    "planType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SowingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SowingPlanEntry" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "variety" TEXT NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "stockType" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "plannedDate" TIMESTAMP(3) NOT NULL,
    "plannedTrays" INTEGER,
    "tunnelId" TEXT,
    "plannedQuantity" INTEGER,
    "sectorId" TEXT,
    "lines" TEXT,
    "metersPerLine" DOUBLE PRECISION,
    "seedsPerMeter" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SowingPlanEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SowingSSM" (
    "id" TEXT NOT NULL,
    "planEntryId" TEXT,
    "variety" TEXT NOT NULL,
    "sowingDate" TIMESTAMP(3) NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "stockType" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "numberOfTrays" INTEGER NOT NULL,
    "seedsPerTray" INTEGER NOT NULL DEFAULT 285,
    "quantityUsed" INTEGER NOT NULL,
    "tunnelId" TEXT NOT NULL,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SowingSSM_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SowingLPM" (
    "id" TEXT NOT NULL,
    "planEntryId" TEXT,
    "variety" TEXT NOT NULL,
    "sowingDate" TIMESTAMP(3) NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "stockType" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "quantityUsed" INTEGER NOT NULL,
    "sectorId" TEXT NOT NULL,
    "lines" TEXT,
    "metersPerLine" DOUBLE PRECISION,
    "seedsPerMeter" INTEGER,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SowingLPM_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tunnel_number_key" ON "Tunnel"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Sector_name_key" ON "Sector"("name");

-- CreateIndex
CREATE INDEX "SowingPlanEntry_planId_idx" ON "SowingPlanEntry"("planId");

-- CreateIndex
CREATE INDEX "SowingPlanEntry_status_idx" ON "SowingPlanEntry"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SowingSSM_planEntryId_key" ON "SowingSSM"("planEntryId");

-- CreateIndex
CREATE INDEX "SowingSSM_tunnelId_idx" ON "SowingSSM"("tunnelId");

-- CreateIndex
CREATE UNIQUE INDEX "SowingLPM_planEntryId_key" ON "SowingLPM"("planEntryId");

-- CreateIndex
CREATE INDEX "SowingLPM_sectorId_idx" ON "SowingLPM"("sectorId");

-- CreateIndex
CREATE UNIQUE INDEX "PlantStock_ssmSowingId_key" ON "PlantStock"("ssmSowingId");

-- CreateIndex
CREATE UNIQUE INDEX "PlantStock_lpmSowingId_key" ON "PlantStock"("lpmSowingId");

-- AddForeignKey
ALTER TABLE "SowingPlanEntry" ADD CONSTRAINT "SowingPlanEntry_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SowingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SowingPlanEntry" ADD CONSTRAINT "SowingPlanEntry_tunnelId_fkey" FOREIGN KEY ("tunnelId") REFERENCES "Tunnel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SowingPlanEntry" ADD CONSTRAINT "SowingPlanEntry_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SowingSSM" ADD CONSTRAINT "SowingSSM_planEntryId_fkey" FOREIGN KEY ("planEntryId") REFERENCES "SowingPlanEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SowingSSM" ADD CONSTRAINT "SowingSSM_tunnelId_fkey" FOREIGN KEY ("tunnelId") REFERENCES "Tunnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SowingLPM" ADD CONSTRAINT "SowingLPM_planEntryId_fkey" FOREIGN KEY ("planEntryId") REFERENCES "SowingPlanEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SowingLPM" ADD CONSTRAINT "SowingLPM_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlantStock" ADD CONSTRAINT "PlantStock_ssmSowingId_fkey" FOREIGN KEY ("ssmSowingId") REFERENCES "SowingSSM"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlantStock" ADD CONSTRAINT "PlantStock_lpmSowingId_fkey" FOREIGN KEY ("lpmSowingId") REFERENCES "SowingLPM"("id") ON DELETE CASCADE ON UPDATE CASCADE;
