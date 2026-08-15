/*
  Warnings:

  - A unique constraint covering the columns `[name]` on the table `SowingPlan` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "SowingPlan_name_key" ON "SowingPlan"("name");
