-- CreateTable
CREATE TABLE "AgriInputSeason" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "currentQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgriInputSeason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgriInputMovement" (
    "id" TEXT NOT NULL,
    "inputSeasonId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgriInputMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgriInputSeason_seasonId_idx" ON "AgriInputSeason"("seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "AgriInputSeason_seasonId_productId_key" ON "AgriInputSeason"("seasonId", "productId");

-- CreateIndex
CREATE INDEX "AgriInputMovement_inputSeasonId_idx" ON "AgriInputMovement"("inputSeasonId");

-- CreateIndex
CREATE INDEX "AgriInputMovement_referenceType_referenceId_idx" ON "AgriInputMovement"("referenceType", "referenceId");

-- AddForeignKey
ALTER TABLE "AgriInputSeason" ADD CONSTRAINT "AgriInputSeason_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgriInputSeason" ADD CONSTRAINT "AgriInputSeason_productId_fkey" FOREIGN KEY ("productId") REFERENCES "PhytosanitaryProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgriInputMovement" ADD CONSTRAINT "AgriInputMovement_inputSeasonId_fkey" FOREIGN KEY ("inputSeasonId") REFERENCES "AgriInputSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
