import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The permission list and the routes must be the same list.
 *
 * `prisma/seed.ts` states it plainly: every permission it declares MUST be
 * enforced by a `@RequirePermissions(...)` route — otherwise the admin screen
 * offers a toggle that changes nothing. The other way round matters just as
 * much: a route demanding a permission the seed does not declare is answered
 * 403 for everyone but ADMIN, for ever, because no administrator can grant a
 * permission that has no row.
 *
 * Nothing linked the two before this spec: the seed is text and the decorators
 * are strings, so both mistakes were silent. This walks the real files and
 * compares the two sets — no database and no running server, source only (P-1).
 *
 * A capability reserved for ADMIN is deliberately NOT in the seed: those routes
 * use `AdminOnlyGuard`, which can never be granted away.
 */

/** The controller files that can carry `@RequirePermissions(...)`. */
function controllerFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      // The generated Prisma client has no controllers, and is huge.
      if (entry.name !== 'generated') {
        files.push(...controllerFiles(full));
      }
    } else if (entry.name.endsWith('.controller.ts')) {
      files.push(full);
    }
  }

  return files;
}

/** Every permission a route demands. */
function enforcedPermissions(): string[] {
  const names: string[] = [];

  for (const file of controllerFiles(join(__dirname, '..'))) {
    const source = readFileSync(file, 'utf8');

    for (const [, name] of source.matchAll(
      /@RequirePermissions\(\s*['"]([^'"]+)['"]/g,
    )) {
      names.push(name);
    }
  }

  return names;
}

/** Every permission the seed declares. */
function seededPermissions(): string[] {
  const source = readFileSync(
    join(__dirname, '..', '..', 'prisma', 'seed.ts'),
    'utf8',
  );

  const start = source.indexOf('const PERMISSIONS = [');
  if (start === -1) return [];

  // Cut the block at the line that closes the array, so unrelated `name:` fields
  // elsewhere in the seed (users, products, trucks …) cannot leak into the list.
  const close = source.indexOf('\n];', start);
  const block = source.slice(start, close === -1 ? undefined : close);

  return [...block.matchAll(/name:\s*['"]([^'"]+)['"]/g)].map(
    ([, name]) => name,
  );
}

describe('permission catalogue', () => {
  const enforced = new Set(enforcedPermissions());
  const seeded = new Set(seededPermissions());

  it('reads both lists - a broken scan must not pass on nothing', () => {
    expect(seeded.size).toBeGreaterThan(30);
    expect(enforced.size).toBeGreaterThan(30);
  });

  it('enforces every permission the seed declares', () => {
    // A seeded permission no route checks: a checkbox that does nothing.
    const dead = [...seeded].filter((name) => !enforced.has(name)).sort();

    expect(dead).toEqual([]);
  });

  it('declares in the seed every permission a route demands', () => {
    // A demanded permission the seed does not declare: 403 for everyone but
    // ADMIN, for ever, because there is no row to grant.
    const ungrantable = [...enforced]
      .filter((name) => !seeded.has(name))
      .sort();

    expect(ungrantable).toEqual([]);
  });
});
