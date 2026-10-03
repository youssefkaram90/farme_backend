/*
  Warnings:

  - A unique constraint covering the columns `[seasonId,name]` on the table `CropCarePlan` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[seasonId,deliveryCode]` on the table `Delivery` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[seasonId,name,planteCode,plantsPerBox]` on the table `HarvestedProduct` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[seasonId,name]` on the table `PhytosanitaryProgram` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[seasonId,location,name]` on the table `Sector` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[seasonId,shipmentNumber]` on the table `Shipment` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[seasonId,location,name]` on the table `SowingPlan` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[seasonId,productType,stockType,lotNumber]` on the table `StockItem` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[seasonId,name]` on the table `Truck` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[seasonId,number]` on the table `Tunnel` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `seasonId` to the `CropCarePlan` table without a default value. This is not possible if the table is not empty.
  - Added the required column `seasonId` to the `CropOperation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `seasonId` to the `Delivery` table without a default value. This is not possible if the table is not empty.
  - Added the required column `seasonId` to the `HarvestRecord` table without a default value. This is not possible if the table is not empty.
  - Added the required column `seasonId` to the `HarvestedProduct` table without a default value. This is not possible if the table is not empty.
  - Added the required column `seasonId` to the `PhytosanitaryProgram` table without a default value. This is not possible if the table is not empty.
  - Added the required column `seasonId` to the `Sector` table without a default value. This is not possible if the table is not empty.
  - Added the required column `seasonId` to the `Shipment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `seasonId` to the `SowingLPM` table without a default value. This is not possible if the table is not empty.
  - Added the required column `seasonId` to the `SowingPlan` table without a default value. This is not possible if the table is not empty.
  - Added the required column `seasonId` to the `SowingSSM` table without a default value. This is not possible if the table is not empty.
  - Added the required column `seasonId` to the `StockItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `seasonId` to the `Truck` table without a default value. This is not possible if the table is not empty.
  - Added the required column `seasonId` to the `Tunnel` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "CropCarePlan_name_key";

-- DropIndex
DROP INDEX "HarvestedProduct_name_planteCode_plantsPerBox_key";

-- DropIndex
DROP INDEX "PhytosanitaryProgram_name_key";

-- DropIndex
DROP INDEX "Sector_location_name_key";

-- DropIndex
DROP INDEX "Shipment_shipmentNumber_key";

-- DropIndex
DROP INDEX "SowingPlan_location_name_key";

-- DropIndex
DROP INDEX "StockItem_productType_stockType_lotNumber_key";

-- DropIndex
DROP INDEX "Truck_name_key";

-- DropIndex
DROP INDEX "Tunnel_number_key";

-- AlterTable
ALTER TABLE "CropCarePlan" ADD COLUMN     "seasonId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "CropOperation" ADD COLUMN     "seasonId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "seasonId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "HarvestRecord" ADD COLUMN     "seasonId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "HarvestedProduct" ADD COLUMN     "seasonId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "PhytosanitaryProgram" ADD COLUMN     "seasonId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Sector" ADD COLUMN     "seasonId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "seasonId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "SowingLPM" ADD COLUMN     "seasonId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "SowingPlan" ADD COLUMN     "seasonId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "SowingSSM" ADD COLUMN     "seasonId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "StockItem" ADD COLUMN     "seasonId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Truck" ADD COLUMN     "seasonId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Tunnel" ADD COLUMN     "seasonId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "activatedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Season_code_key" ON "Season"("code");

-- CreateIndex
CREATE INDEX "Season_status_idx" ON "Season"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CropCarePlan_seasonId_name_key" ON "CropCarePlan"("seasonId", "name");

-- CreateIndex
CREATE INDEX "CropOperation_seasonId_idx" ON "CropOperation"("seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_seasonId_deliveryCode_key" ON "Delivery"("seasonId", "deliveryCode");

-- CreateIndex
CREATE INDEX "HarvestRecord_seasonId_idx" ON "HarvestRecord"("seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "HarvestedProduct_seasonId_name_planteCode_plantsPerBox_key" ON "HarvestedProduct"("seasonId", "name", "planteCode", "plantsPerBox");

-- CreateIndex
CREATE UNIQUE INDEX "PhytosanitaryProgram_seasonId_name_key" ON "PhytosanitaryProgram"("seasonId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Sector_seasonId_location_name_key" ON "Sector"("seasonId", "location", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_seasonId_shipmentNumber_key" ON "Shipment"("seasonId", "shipmentNumber");

-- CreateIndex
CREATE INDEX "SowingLPM_seasonId_idx" ON "SowingLPM"("seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "SowingPlan_seasonId_location_name_key" ON "SowingPlan"("seasonId", "location", "name");

-- CreateIndex
CREATE INDEX "SowingSSM_seasonId_idx" ON "SowingSSM"("seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "StockItem_seasonId_productType_stockType_lotNumber_key" ON "StockItem"("seasonId", "productType", "stockType", "lotNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Truck_seasonId_name_key" ON "Truck"("seasonId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Tunnel_seasonId_number_key" ON "Tunnel"("seasonId", "number");

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tunnel" ADD CONSTRAINT "Tunnel_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sector" ADD CONSTRAINT "Sector_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SowingPlan" ADD CONSTRAINT "SowingPlan_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SowingSSM" ADD CONSTRAINT "SowingSSM_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SowingLPM" ADD CONSTRAINT "SowingLPM_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhytosanitaryProgram" ADD CONSTRAINT "PhytosanitaryProgram_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CropCarePlan" ADD CONSTRAINT "CropCarePlan_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CropOperation" ADD CONSTRAINT "CropOperation_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HarvestRecord" ADD CONSTRAINT "HarvestRecord_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HarvestedProduct" ADD CONSTRAINT "HarvestedProduct_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Truck" ADD CONSTRAINT "Truck_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
