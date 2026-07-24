/*
  Warnings:

  - You are about to drop the column `cropType` on the `PlantStock` table. All the data in the column will be lost.
  - You are about to drop the column `cropType` on the `Sowing` table. All the data in the column will be lost.
  - You are about to drop the column `greenhouse` on the `Sowing` table. All the data in the column will be lost.
  - Added the required column `deliveryCode` to the `Delivery` table without a default value. This is not possible if the table is not empty.
  - Added the required column `variety` to the `PlantStock` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sowingType` to the `Sowing` table without a default value. This is not possible if the table is not empty.
  - Added the required column `variety` to the `Sowing` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "PlantStock_cropType_idx";

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "deliveryCode" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "PlantStock" DROP COLUMN "cropType",
ADD COLUMN     "variety" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Sowing" DROP COLUMN "cropType",
DROP COLUMN "greenhouse",
ADD COLUMN     "sowingType" TEXT NOT NULL,
ADD COLUMN     "variety" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "PlantStock_variety_idx" ON "PlantStock"("variety");
