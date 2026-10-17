/*
  Warnings:

  - Added the required column `peatLotNumber` to the `SowingSSM` table without a default value. This is not possible if the table is not empty.
  - Added the required column `peatStockType` to the `SowingSSM` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "SowingSSM" ADD COLUMN     "peatLotNumber" TEXT NOT NULL,
ADD COLUMN     "peatStockType" TEXT NOT NULL;
