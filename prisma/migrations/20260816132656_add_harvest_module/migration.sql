-- CreateTable
CREATE TABLE "HarvestRecord" (
    "id" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "tunnelId" TEXT,
    "sectorId" TEXT,
    "stockType" TEXT,
    "boxCount" INTEGER NOT NULL,
    "plantsPerBox" INTEGER NOT NULL,
    "totalPlants" INTEGER NOT NULL,
    "harvestedAt" TIMESTAMP(3) NOT NULL,
    "plantStockId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HarvestRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HarvestedProduct" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'PLANT',
    "currentQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HarvestedProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HarvestStockMovement" (
    "id" TEXT NOT NULL,
    "harvestedProductId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HarvestStockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HarvestRecord_targetType_idx" ON "HarvestRecord"("targetType");

-- CreateIndex
CREATE INDEX "HarvestRecord_tunnelId_idx" ON "HarvestRecord"("tunnelId");

-- CreateIndex
CREATE INDEX "HarvestRecord_sectorId_idx" ON "HarvestRecord"("sectorId");

-- CreateIndex
CREATE INDEX "HarvestRecord_harvestedAt_idx" ON "HarvestRecord"("harvestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HarvestedProduct_name_key" ON "HarvestedProduct"("name");

-- CreateIndex
CREATE INDEX "HarvestStockMovement_harvestedProductId_idx" ON "HarvestStockMovement"("harvestedProductId");

-- CreateIndex
CREATE INDEX "HarvestStockMovement_referenceType_referenceId_idx" ON "HarvestStockMovement"("referenceType", "referenceId");

-- AddForeignKey
ALTER TABLE "HarvestRecord" ADD CONSTRAINT "HarvestRecord_tunnelId_fkey" FOREIGN KEY ("tunnelId") REFERENCES "Tunnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HarvestRecord" ADD CONSTRAINT "HarvestRecord_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HarvestRecord" ADD CONSTRAINT "HarvestRecord_plantStockId_fkey" FOREIGN KEY ("plantStockId") REFERENCES "PlantStock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HarvestStockMovement" ADD CONSTRAINT "HarvestStockMovement_harvestedProductId_fkey" FOREIGN KEY ("harvestedProductId") REFERENCES "HarvestedProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
