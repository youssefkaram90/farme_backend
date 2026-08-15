import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  }),
});

const PERMISSIONS = [
  { name: 'deliveries.view', description: 'View deliveries' },
  { name: 'deliveries.create', description: 'Create deliveries' },
  { name: 'deliveries.edit', description: 'Edit deliveries' },
  { name: 'deliveries.delete', description: 'Delete deliveries' },
  { name: 'sowing.view', description: 'View sowing records' },
  { name: 'sowing.create', description: 'Create sowing records' },
  { name: 'sowing.edit', description: 'Edit sowing records' },
  { name: 'sowing.delete', description: 'Delete sowing records' },
  { name: 'stock.view', description: 'View stock' },
  { name: 'stock.create', description: 'Create stock' },
  { name: 'stock.edit', description: 'Edit stock' },
  { name: 'stock.delete', description: 'Delete stock' },
  { name: 'users.view', description: 'View users' },
  { name: 'users.edit', description: 'Edit user roles' },
  { name: 'permissions.view', description: 'View permissions' },
  { name: 'permissions.manage', description: 'Manage user permissions' },
];

async function main() {
  console.log('🌱 Seeding permissions...\n');

  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { name: perm.name },
      update: { description: perm.description },
      create: perm,
    });
    console.log(`  ✅ ${perm.name}`);
  }

  const count = await prisma.permission.count();
  console.log(`\n🎉 Done! ${count} permissions in the database.`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
