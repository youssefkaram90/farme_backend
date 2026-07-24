/*
  Warnings:

  - Added the required column `deliveryDate` to the `Delivery` table without a default value. This is not possible if the table is not empty.
  - Added the required column `productName` to the `DeliveryLot` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "deliveryDate" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "DeliveryLot" ADD COLUMN     "productName" TEXT NOT NULL;
