-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "stockType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryLot" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "thousandSeedsPerGram" INTEGER,
    "productType" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryLot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryLot_deliveryId_idx" ON "DeliveryLot"("deliveryId");

-- AddForeignKey
ALTER TABLE "DeliveryLot" ADD CONSTRAINT "DeliveryLot_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
