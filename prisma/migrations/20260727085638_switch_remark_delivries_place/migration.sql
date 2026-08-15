/*
  Warnings:

  - You are about to drop the column `remark` on the `DeliveryLot` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "remark" TEXT;

-- AlterTable
ALTER TABLE "DeliveryLot" DROP COLUMN "remark";
