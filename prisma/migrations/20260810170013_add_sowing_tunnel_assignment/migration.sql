-- CreateTable
CREATE TABLE "SowingTunnelAssignment" (
    "id" TEXT NOT NULL,
    "ssmSowingId" TEXT NOT NULL,
    "tunnelId" TEXT NOT NULL,
    "numberOfTrays" INTEGER NOT NULL,
    "transportDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SowingTunnelAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SowingTunnelAssignment_ssmSowingId_idx" ON "SowingTunnelAssignment"("ssmSowingId");

-- CreateIndex
CREATE INDEX "SowingTunnelAssignment_tunnelId_idx" ON "SowingTunnelAssignment"("tunnelId");

-- CreateIndex
CREATE UNIQUE INDEX "SowingTunnelAssignment_ssmSowingId_tunnelId_key" ON "SowingTunnelAssignment"("ssmSowingId", "tunnelId");

-- AddForeignKey
ALTER TABLE "SowingTunnelAssignment" ADD CONSTRAINT "SowingTunnelAssignment_ssmSowingId_fkey" FOREIGN KEY ("ssmSowingId") REFERENCES "SowingSSM"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SowingTunnelAssignment" ADD CONSTRAINT "SowingTunnelAssignment_tunnelId_fkey" FOREIGN KEY ("tunnelId") REFERENCES "Tunnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
