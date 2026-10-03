import { BadRequestException } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { ERROR_MESSAGES } from '../common/error-messages';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * The permission swap (PERM-01 / PERM-02).
 *
 * What these guard against: the delete used to run before the insert as a
 * separate statement, so a bad — or merely duplicated — id left the user with NO
 * permissions at all. Two outcomes are legal now, the new list or the old one,
 * and never a third.
 *
 * Runs against a fake of the four Prisma calls involved: no database, no Docker.
 */

const USER_ID = 'user-1';

type Link = {
  userId: string;
  permissionId: string;
  permission: { id: string; name: string };
};

class FakeDb {
  users: { id: string }[] = [];
  permissions: { id: string; name: string }[] = [];
  links: Link[] = [];

  /** True while a `$transaction` callback runs, so a test can prove atomicity. */
  inTransaction = false;

  /** Every write, in order, and whether it happened inside the transaction. */
  writes: { operation: string; inTransaction: boolean }[] = [];

  user = {
    findUnique: ({ where }: { where: { id: string } }) =>
      Promise.resolve(this.users.find((user) => user.id === where.id) ?? null),
  };

  permission = {
    findMany: ({ where }: { where: { id: { in: string[] } } }) =>
      Promise.resolve(
        this.permissions
          .filter((permission) => where.id.in.includes(permission.id))
          .map((permission) => ({ id: permission.id })),
      ),
  };

  userPermission = {
    findMany: ({ where }: { where: { userId: string } }) =>
      Promise.resolve(
        this.links.filter((link) => link.userId === where.userId),
      ),

    deleteMany: ({ where }: { where: { userId: string } }) => {
      this.writes.push({
        operation: 'deleteMany',
        inTransaction: this.inTransaction,
      });

      const before = this.links.length;
      this.links = this.links.filter((link) => link.userId !== where.userId);
      return Promise.resolve({ count: before - this.links.length });
    },

    createMany: ({
      data,
    }: {
      data: { userId: string; permissionId: string }[];
    }) => {
      this.writes.push({
        operation: 'createMany',
        inTransaction: this.inTransaction,
      });

      for (const row of data) {
        const permission = this.permissions.find(
          (candidate) => candidate.id === row.permissionId,
        );

        // Prisma raises P2003 here. This has to stay unreachable: the ids are
        // checked before anything is deleted.
        if (!permission)
          return Promise.reject(new Error('foreign key violated'));

        this.links.push({ ...row, permission });
      }

      return Promise.resolve({ count: data.length });
    },
  };

  $transaction = async (callback: (tx: FakeDb) => Promise<unknown>) => {
    this.inTransaction = true;
    try {
      return await callback(this);
    } finally {
      this.inTransaction = false;
    }
  };
}

function setup() {
  const db = new FakeDb();
  db.users.push({ id: USER_ID });
  db.permissions.push(
    { id: 'perm-sowing', name: 'sowing.view' },
    { id: 'perm-stock', name: 'stock.view' },
  );

  const service = new PermissionsService(db as unknown as PrismaService);

  return { service, db };
}

describe('setUserPermissions', () => {
  it('swaps the list inside ONE transaction, so no half-way state can exist', async () => {
    const { service, db } = setup();
    db.links.push({
      userId: USER_ID,
      permissionId: 'perm-sowing',
      permission: db.permissions[0],
    });

    const result = await service.setUserPermissions(USER_ID, ['perm-stock']);

    expect(db.writes).toEqual([
      { operation: 'deleteMany', inTransaction: true },
      { operation: 'createMany', inTransaction: true },
    ]);
    expect(result.map((permission) => permission.id)).toEqual(['perm-stock']);
  });

  it('leaves the previous permissions UNTOUCHED when an id no longer exists', async () => {
    const { service, db } = setup();
    db.links.push({
      userId: USER_ID,
      permissionId: 'perm-sowing',
      permission: db.permissions[0],
    });

    await expect(
      service.setUserPermissions(USER_ID, [
        'perm-sowing',
        'perm-deleted-elsewhere',
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);

    // The regression: the old code deleted first, so this list was empty — and
    // the user lost every screen they could open.
    expect(db.links.map((link) => link.permissionId)).toEqual(['perm-sowing']);
    expect(db.writes).toEqual([]);
  });

  it('collapses a duplicated id instead of failing on the composite primary key', async () => {
    const { service, db } = setup();

    const result = await service.setUserPermissions(USER_ID, [
      'perm-stock',
      'perm-stock',
    ]);

    expect(result.map((permission) => permission.id)).toEqual(['perm-stock']);
    expect(db.links).toHaveLength(1);
  });

  it('clears everything for an empty list — a real choice, not an error', async () => {
    const { service, db } = setup();
    db.links.push({
      userId: USER_ID,
      permissionId: 'perm-sowing',
      permission: db.permissions[0],
    });

    const result = await service.setUserPermissions(USER_ID, []);

    expect(result).toEqual([]);
    expect(db.links).toEqual([]);
    expect(db.writes).toEqual([
      { operation: 'deleteMany', inTransaction: true },
    ]);
  });

  it('404s for a user that does not exist, before touching anything', async () => {
    const { service, db } = setup();

    await expect(service.setUserPermissions('nobody', [])).rejects.toThrow(
      ERROR_MESSAGES.userNotFound,
    );
    expect(db.writes).toEqual([]);
  });
});

describe('getUserPermissions', () => {
  it('404s for an unknown user instead of answering "no permissions"', async () => {
    const { service } = setup();

    await expect(service.getUserPermissions('nobody')).rejects.toThrow(
      ERROR_MESSAGES.userNotFound,
    );
  });

  it('still answers an empty list for a real user who has none', async () => {
    const { service } = setup();

    await expect(service.getUserPermissions(USER_ID)).resolves.toEqual([]);
  });
});
