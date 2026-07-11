/*
  Warnings:

  - You are about to drop the column `refreashToken` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "refreashToken",
ADD COLUMN     "refreshToken" TEXT;
