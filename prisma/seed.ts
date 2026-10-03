import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { seasonBounds, startYearFromCode } from '../src/common/season-code';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  }),
});

/**
 * Every permission here MUST be enforced by a `@RequirePermissions(...)` route
 * decorator — otherwise it is dead configuration that the admin UI offers as a
 * toggle with no effect.
 *
 * Actions that are reserved for ADMIN (creating users, changing roles, setting
 * permissions) are intentionally NOT listed: they are enforced by AdminOnlyGuard,
 * so they can never be granted away.
 */
const PERMISSIONS = [
  // --- Deliveries ---
  { name: 'deliveries.view', description: 'View deliveries' },
  { name: 'deliveries.create', description: 'Create deliveries' },
  { name: 'deliveries.edit', description: 'Edit deliveries' },
  { name: 'deliveries.delete', description: 'Delete deliveries' },

  // --- Sowing (plans, tunnel sowings, field sowings) ---
  { name: 'sowing.view', description: 'View sowing plans and sowings' },
  { name: 'sowing.create', description: 'Create plans and record sowings' },
  { name: 'sowing.edit', description: 'Edit plans, plan entries and sowings' },
  { name: 'sowing.delete', description: 'Delete plans, entries and sowings' },

  // --- Stock (read-only: quantities change via deliveries & sowing) ---
  { name: 'stock.view', description: 'View stock and stock movements' },

  // --- Tunnels ---
  { name: 'tunnels.view', description: 'View tunnels' },
  { name: 'tunnels.create', description: 'Create tunnels' },
  { name: 'tunnels.edit', description: 'Edit tunnels' },
  { name: 'tunnels.delete', description: 'Delete tunnels' },

  // --- Sectors ---
  { name: 'sectors.view', description: 'View sectors' },
  { name: 'sectors.create', description: 'Create sectors' },
  { name: 'sectors.edit', description: 'Edit sectors' },
  { name: 'sectors.delete', description: 'Delete sectors' },

  // --- Plant stock ---
  { name: 'plant-stock.view', description: 'View plant stock' },
  { name: 'plant-stock.create', description: 'Record plant counts' },
  {
    name: 'plant-stock.edit',
    description: 'Edit plant stock stage and details',
  },

  // Tray transport has NO permissions of its own: moving trays is the last step of
  // a sowing, so its routes ride `sowing.view` / `sowing.create` / `sowing.edit` /
  // `sowing.delete` (TRAY-05).
  //
  // NOTE: this seed deletes permissions it no longer declares, and the delete
  // cascades to the grants — so the four `tray-transport.*` rows and every grant
  // of them disappear on the next run. Anybody who had only those needs the
  // `sowing.*` ones instead.

  // --- Harvest ---
  { name: 'harvest.view', description: 'View harvest records and products' },
  { name: 'harvest.create', description: 'Record harvests' },
  { name: 'harvest.delete', description: 'Delete harvest records' },
  { name: 'shipments.view', description: 'View shipments' },
  { name: 'shipments.create', description: 'Create shipments' },
  { name: 'shipments.edit', description: 'Edit shipments' },
  { name: 'shipments.delete', description: 'Delete shipments' },
  { name: 'trucks.view', description: 'View trucks' },
  { name: 'trucks.create', description: 'Add trucks and their plates' },
  { name: 'trucks.edit', description: 'Edit trucks and their plates' },
  { name: 'trucks.delete', description: 'Delete trucks' },

  // --- Crop care (irrigation & treatment plans and operations) ---
  {
    name: 'crop-care.view',
    description: 'View crop care plans and operations',
  },
  { name: 'crop-care.create', description: 'Create plans and log operations' },
  {
    name: 'crop-care.edit',
    description: 'Edit plans, entries and execute them',
  },
  {
    name: 'crop-care.delete',
    description: 'Delete plans, entries and operations',
  },

  // --- Phytosanitary (products, program, compliance) ---
  {
    name: 'phytosanitary.view',
    description: 'View products, program and compliance',
  },
  {
    name: 'phytosanitary.create',
    description: 'Create products and program entries',
  },
  { name: 'phytosanitary.edit', description: 'Edit products and the program' },
  { name: 'phytosanitary.delete', description: 'Delete products' },

  // --- Users / permissions (view only; mutations are ADMIN-only) ---
  { name: 'users.view', description: 'View users' },
  {
    name: 'permissions.view',
    description: 'View permissions and their assignments',
  },
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

  // Drop permissions that are no longer declared above so the admin UI never
  // offers a toggle that does nothing. Cascades to UserPermission.
  const stale = await prisma.permission.deleteMany({
    where: { name: { notIn: PERMISSIONS.map((p) => p.name) } },
  });
  if (stale.count > 0) {
    console.log(`\n  🧹 Removed ${stale.count} stale permission(s)`);
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
