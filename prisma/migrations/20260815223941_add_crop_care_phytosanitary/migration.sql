-- CreateTable
CREATE TABLE "PhytosanitaryProduct" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "activeIngredient" TEXT,
    "category" TEXT,
    "unit" TEXT,
    "notes" TEXT,
    "currentQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhytosanitaryProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhytosanitaryProgram" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhytosanitaryProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhytosanitaryProgramEntry" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhytosanitaryProgramEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CropCarePlan" (
    "id" TEXT NOT NULL,
    "planType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CropCarePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CropCarePlanLocation" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "tunnelId" TEXT,
    "sectorId" TEXT,

    CONSTRAINT "CropCarePlanLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CropCarePlanEntry" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "plannedDate" TIMESTAMP(3) NOT NULL,
    "productId" TEXT,
    "quantity" DOUBLE PRECISION,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "executedAt" TIMESTAMP(3),
    "executedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CropCarePlanEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CropOperation" (
    "id" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "productId" TEXT,
    "source" TEXT NOT NULL,
    "planEntryId" TEXT,
    "quantity" DOUBLE PRECISION,
    "performedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CropOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CropOperationLocation" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "tunnelId" TEXT,
    "sectorId" TEXT,

    CONSTRAINT "CropOperationLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PhytosanitaryProduct_name_key" ON "PhytosanitaryProduct"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PhytosanitaryProgram_name_key" ON "PhytosanitaryProgram"("name");

-- CreateIndex
CREATE INDEX "PhytosanitaryProgramEntry_programId_idx" ON "PhytosanitaryProgramEntry"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "PhytosanitaryProgramEntry_programId_productId_key" ON "PhytosanitaryProgramEntry"("programId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "CropCarePlan_name_key" ON "CropCarePlan"("name");

-- CreateIndex
CREATE INDEX "CropCarePlanLocation_planId_idx" ON "CropCarePlanLocation"("planId");

-- CreateIndex
CREATE INDEX "CropCarePlanEntry_planId_idx" ON "CropCarePlanEntry"("planId");

-- CreateIndex
CREATE INDEX "CropCarePlanEntry_status_idx" ON "CropCarePlanEntry"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CropOperation_planEntryId_key" ON "CropOperation"("planEntryId");

-- CreateIndex
CREATE INDEX "CropOperation_operationType_idx" ON "CropOperation"("operationType");

-- CreateIndex
CREATE INDEX "CropOperation_performedAt_idx" ON "CropOperation"("performedAt");

-- CreateIndex
CREATE INDEX "CropOperation_productId_idx" ON "CropOperation"("productId");

-- CreateIndex
CREATE INDEX "CropOperationLocation_operationId_idx" ON "CropOperationLocation"("operationId");

-- CreateIndex
CREATE INDEX "CropOperationLocation_tunnelId_idx" ON "CropOperationLocation"("tunnelId");

-- CreateIndex
CREATE INDEX "CropOperationLocation_sectorId_idx" ON "CropOperationLocation"("sectorId");

-- AddForeignKey
ALTER TABLE "PhytosanitaryProgramEntry" ADD CONSTRAINT "PhytosanitaryProgramEntry_programId_fkey" FOREIGN KEY ("programId") REFERENCES "PhytosanitaryProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhytosanitaryProgramEntry" ADD CONSTRAINT "PhytosanitaryProgramEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "PhytosanitaryProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CropCarePlanLocation" ADD CONSTRAINT "CropCarePlanLocation_planId_fkey" FOREIGN KEY ("planId") REFERENCES "CropCarePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CropCarePlanLocation" ADD CONSTRAINT "CropCarePlanLocation_tunnelId_fkey" FOREIGN KEY ("tunnelId") REFERENCES "Tunnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CropCarePlanLocation" ADD CONSTRAINT "CropCarePlanLocation_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CropCarePlanEntry" ADD CONSTRAINT "CropCarePlanEntry_planId_fkey" FOREIGN KEY ("planId") REFERENCES "CropCarePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CropCarePlanEntry" ADD CONSTRAINT "CropCarePlanEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "PhytosanitaryProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CropOperation" ADD CONSTRAINT "CropOperation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "PhytosanitaryProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CropOperation" ADD CONSTRAINT "CropOperation_planEntryId_fkey" FOREIGN KEY ("planEntryId") REFERENCES "CropCarePlanEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CropOperationLocation" ADD CONSTRAINT "CropOperationLocation_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "CropOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CropOperationLocation" ADD CONSTRAINT "CropOperationLocation_tunnelId_fkey" FOREIGN KEY ("tunnelId") REFERENCES "Tunnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CropOperationLocation" ADD CONSTRAINT "CropOperationLocation_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE CASCADE ON UPDATE CASCADE;
