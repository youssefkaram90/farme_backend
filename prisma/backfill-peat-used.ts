// One-off backfill: SowingSSM gained `peatUsed` — the peat each sowing actually
// took, in big balls, stored instead of being recomputed on every reversal.
//
// Existing rows are filled with `numberOfTrays / TRAYS_PER_PEAT_BALL`. That is not
// a guess: `TRAYS_PER_PEAT_BALL` is the only figure this app has ever used, and it
// is exactly the value those sowings were deducted with — so the reversal gives
// back what was taken. Hence the import rather than a repeated literal: this file
// must not become a second source for the number (SOW-11).
//
// Safe to re-run: it only touches rows whose `peatUsed` is still null.
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { TRAYS_PER_PEAT_BALL } from '../src/common/sowing.constants';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  }),
});

async function main() {
  // A local constant, never user input, so interpolating it is safe.
  const result = await prisma.$executeRawUnsafe(
    `UPDATE "SowingSSM"
        SET "peatUsed" = "numberOfTrays"::float / ${TRAYS_PER_PEAT_BALL}
      WHERE "peatUsed" IS NULL;`,
  );
  console.log(`Backfilled ${result} SowingSSM row(s)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
