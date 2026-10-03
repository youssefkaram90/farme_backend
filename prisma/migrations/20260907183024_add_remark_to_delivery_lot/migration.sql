/*
  Warnings:

  - Made the column `code` on table `SowingSSM` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "DeliveryLot" ADD COLUMN     "remark" TEXT;

-- AlterTable
ALTER TABLE "SowingSSM" ALTER COLUMN "code" SET NOT NULL;
