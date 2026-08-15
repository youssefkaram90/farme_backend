-- DropForeignKey
ALTER TABLE "SowingSSM" DROP CONSTRAINT "SowingSSM_tunnelId_fkey";

-- AlterTable
ALTER TABLE "SowingSSM" ALTER COLUMN "tunnelId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "SowingSSM" ADD CONSTRAINT "SowingSSM_tunnelId_fkey" FOREIGN KEY ("tunnelId") REFERENCES "Tunnel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
