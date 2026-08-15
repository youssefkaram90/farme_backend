// One-off backfill: for existing PlantStock rows, seedsSown was not set
// when they were created. At creation, expectedPlants === quantityUsed (seeds sown),
// so we copy expectedPlants into seedsSown for rows that still have seedsSown = 0.
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  }),
});

async function main() {
  const result = await prisma.$executeRawUnsafe(
    `UPDATE "PlantStock" SET "seedsSown" = "expectedPlants" WHERE "seedsSown" = 0;`,
  );
  console.log(`Backfilled ${result} PlantStock row(s)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
