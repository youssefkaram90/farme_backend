// One-off backfill: re-derive SowingPlanEntry.executedTrays / executedQuantity
// and status from the linked sowings. Run once after deploying the
// syncPlanEntryProgress() fix to repair pre-existing drift.
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { syncPlanEntryProgress } from '../src/sowing-plan/plan-entry-progress';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  }),
});

async function main() {
  const entries = await prisma.sowingPlanEntry.findMany({
    select: { id: true },
  });

  for (const e of entries) {
    await syncPlanEntryProgress(prisma, e.id);
  }

  console.log(`Synced ${entries.length} plan entry(ies)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
