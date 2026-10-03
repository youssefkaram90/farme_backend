import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { UserRole } from './enums/userRole.enum';
import { ERROR_MESSAGES } from '../common/error-messages';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * What a user row looks like when it leaves the service (USERS-01 / 02 / 03).
 *
 * The password hash is the whole point. It may leave through `getUser` — which
 * exists for sign-in and nothing else — and must NOT leave through anything
 * else. The worst leak was not a screen at all: the JWT strategy builds
 * `request.user` from this service on **every** authenticated request, so a
 * safe fetch here is the difference between a hash in memory and a hash on every
 * request object in the app.
 *
 * Runs against a fake of the five Prisma calls involved: no database, no Docker.
 * `argon2` is real, so the hashing is genuinely exercised rather than mocked.
 */

type Row = {
  id: string;
  name: string;
  lastName: string | null;
  password: string;
  role: string;
};

type Args = {
  where?: Record<string, unknown>;
  data?: Record<string, unknown>;
  select?: Record<string, true>;
  omit?: Record<string, true>;
};

class FakeUsers {
  rows: Row[] = [];

  /** Every call the service made, so a test can inspect the query it built. */
  calls: { method: string; args: Args }[] = [];

  user = {
    findFirst: (args: Args) => {
      this.calls.push({ method: 'findFirst', args });
      const row = this.rows.find((candidate) =>
        this.matches(candidate, args.where ?? {}),
      );

      return Promise.resolve(row ? this.project(row, args) : null);
    },

    findMany: (args: Args) => {
      this.calls.push({ method: 'findMany', args });
      return Promise.resolve(this.rows.map((row) => this.project(row, args)));
    },

    create: (args: Args) => {
      this.calls.push({ method: 'create', args });
      const row = {
        id: `u-${this.rows.length + 1}`,
        lastName: null,
        role: UserRole.USER,
        ...(args.data as Partial<Row>),
      } as Row;

      this.rows.push(row);
      return Promise.resolve(this.project(row, args));
    },

    update: (args: Args) => {
      this.calls.push({ method: 'update', args });
      const row = this.rows.find(
        (candidate) => candidate.id === args.where?.id,
      );

      if (!row) {
        // Prisma raises P2025 here, which the service maps to the ordinary
        // "no such user" 404.
        return Promise.reject(
          Object.assign(new Error('Record not found'), { code: 'P2025' }),
        );
      }

      Object.assign(row, args.data);
      return Promise.resolve(this.project(row, args));
    },
  };

  /** Only the keys the tests actually use: `id` and `name`. */
  private matches(row: Row, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (key !== 'id' && key !== 'name') return true;
      return row[key as 'id' | 'name'] === value;
    });
  }

  /** `omit` is what keeps the hash in, so honouring it is the thing under test. */
  private project(row: Row, args: Args): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...row };

    if (args.select) {
      return Object.fromEntries(
        Object.keys(args.select).map((key) => [key, copy[key]]),
      );
    }

    for (const key of Object.keys(args.omit ?? {})) {
      delete copy[key];
    }

    return copy;
  }
}

function setup() {
  const db = new FakeUsers();
  db.rows.push({
    id: 'user-1',
    name: 'Krypton',
    lastName: 'Meyer',
    password: 'stored-hash',
    role: UserRole.MANAGER,
  });

  const service = new UsersService(db as unknown as PrismaService);

  return { service, db };
}

describe('the password hash', () => {
  it('is returned by getUser, which exists for sign-in', async () => {
    const { service } = setup();

    await expect(service.getUser({ name: 'Krypton' })).resolves.toMatchObject({
      id: 'user-1',
      password: 'stored-hash',
    });
  });

  it('is NEVER returned by getUserSafe — this is what builds request.user', async () => {
    const { service } = setup();

    const user = await service.getUserSafe({ id: 'user-1' });

    expect(user).toMatchObject({ id: 'user-1', name: 'Krypton' });
    expect('password' in user).toBe(false);
  });

  it('is stripped from the list too', async () => {
    const { service } = setup();

    const [user] = await service.getUsers();

    expect('password' in user).toBe(false);
  });

  it('is not in what create hands back', async () => {
    const { service, db } = setup();

    const created = await service.create({
      name: 'Newbar',
      password: 'plain-text',
      role: UserRole.USER,
    });

    expect('password' in created).toBe(false);
    // Real argon2: the row holds a hash, not what was typed.
    const stored = db.rows.find((row) => row.name === 'Newbar');
    expect(stored?.password).not.toBe('plain-text');
    expect(stored?.password.startsWith('$argon2')).toBe(true);
  });
});

describe('a user that does not exist', () => {
  it('is the "no longer exists" 404 from getUser', async () => {
    const { service } = setup();

    await expect(service.getUser({ id: 'gone' })).rejects.toBeInstanceOf(
      NotFoundException,
    );

    await expect(service.getUser({ id: 'gone' })).rejects.toThrow(
      ERROR_MESSAGES.userNotFound,
    );
  });

  it('is the same 404 from getUserSafe', async () => {
    const { service } = setup();

    await expect(service.getUserSafe({ id: 'gone' })).rejects.toThrow(
      ERROR_MESSAGES.userNotFound,
    );
  });
});

describe('the user search (USERS-03)', () => {
  it('matches a name anywhere in it, but a role only exactly', async () => {
    const { service, db } = setup();

    await service.getUsers('us');

    const { where } = db.calls.find((call) => call.method === 'findMany')!.args;

    expect(where).toEqual({
      OR: [
        { name: { contains: 'us', mode: 'insensitive' } },
        { lastName: { contains: 'us', mode: 'insensitive' } },
        { role: { equals: 'us', mode: 'insensitive' } },
      ],
    });
  });

  it('asks for everything when there is no search text', async () => {
    const { service, db } = setup();

    await service.getUsers();

    const { where } = db.calls.find((call) => call.method === 'findMany')!.args;

    expect(where).toEqual({});
  });
});

describe('changing a role (USERS-01)', () => {
  it('updates by id and answers with the user, hash omitted', async () => {
    const { service, db } = setup();

    const updated = await service.updateUserRole('user-1', UserRole.ADMIN);

    expect(updated).toMatchObject({ id: 'user-1', role: UserRole.ADMIN });
    expect('password' in updated).toBe(false);

    const { args } = db.calls.find((call) => call.method === 'update')!;
    expect(args.where).toEqual({ id: 'user-1' });
    expect(args.data).toEqual({ role: UserRole.ADMIN });
  });

  it('does not turn an unrelated database failure into a 404', async () => {
    // Only P2025 means "no such user". Anything else has to reach the filter,
    // which logs it and answers 500 — the same rule the sign-in path follows.
    const { service, db } = setup();
    db.user.update = () =>
      Promise.reject(Object.assign(new Error('connection lost'), {}));

    await expect(
      service.updateUserRole('user-1', UserRole.ADMIN),
    ).rejects.toThrow('connection lost');
  });
});
