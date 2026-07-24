/*
  Warnings:

  - Added the required column `productName` to the `StockItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `supplierName` to the `StockItem` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "StockItem" ADD COLUMN     "productName" TEXT NOT NULL,
ADD COLUMN     "supplierName" TEXT NOT NULL;
