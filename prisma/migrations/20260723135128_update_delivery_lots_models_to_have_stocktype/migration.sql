/*
  Warnings:

  - You are about to drop the column `stockType` on the `Delivery` table. All the data in the column will be lost.
  - Added the required column `stockType` to the `DeliveryLot` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Delivery" DROP COLUMN "stockType";

-- AlterTable
ALTER TABLE "DeliveryLot" ADD COLUMN     "stockType" TEXT NOT NULL;
