-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "shipmentNumber" TEXT NOT NULL,
    "shipmentDate" TIMESTAMP(3) NOT NULL,
    "truck" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentLine" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "harvestedProductId" TEXT NOT NULL,
    "boxCount" INTEGER NOT NULL,
    "plantsPerBox" INTEGER NOT NULL,
    "totalPlants" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Shipment_shipmentDate_idx" ON "Shipment"("shipmentDate");

-- CreateIndex
CREATE INDEX "Shipment_shipmentNumber_idx" ON "Shipment"("shipmentNumber");

-- CreateIndex
CREATE INDEX "ShipmentLine_shipmentId_idx" ON "ShipmentLine"("shipmentId");

-- CreateIndex
CREATE INDEX "ShipmentLine_harvestedProductId_idx" ON "ShipmentLine"("harvestedProductId");

-- CreateIndex
CREATE INDEX "HarvestRecord_plantStockId_idx" ON "HarvestRecord"("plantStockId");

-- AddForeignKey
ALTER TABLE "ShipmentLine" ADD CONSTRAINT "ShipmentLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentLine" ADD CONSTRAINT "ShipmentLine_harvestedProductId_fkey" FOREIGN KEY ("harvestedProductId") REFERENCES "HarvestedProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
