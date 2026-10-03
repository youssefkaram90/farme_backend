import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { ERROR_MESSAGES } from '../common/error-messages';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import type { User } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { UsersService } from '../users/users.service';

/**
 * Rotation, reuse detection and sign-out (AUTH-01 / 02 / 03 / 05 / 07).
 *
 * They run against an in-memory fake of the handful of `refreshToken` methods
 * the service uses: no database, no Docker, no Nest bootstrap. argon2 is REAL,
 * so the hashed-token comparison is genuinely exercised rather than mocked.
 *
 * NOT covered: the database's own concurrency behaviour. A fake cannot reproduce
 * Postgres blocking a losing `UPDATE` on the winner's open transaction, which is
 * what makes the claim in `rotateRefreshToken` atomic — that needs a live
 * Postgres and belongs in an opt-in e2e spec.
 */

const USER_ID = 'user-1';
const FAMILY_ID = 'family-1';
const PLAIN_TOKEN = 'signed-refresh-token';

const metadata = { userAgent: 'agent-A', ipAddress: '10.0.0.1' };

type RefreshRow = {
  id: string;
  userId: string;
  jti: string;
  familyId: string;
  hashedToken: string;
  deviceId: string | null;
  deviceName: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date;
};

type Where = {
  id?: string;
  userId?: string;
  jti?: string;
  familyId?: string;
  revokedAt?: null;
};

/** Only the filters and operations the service actually uses. */
class FakeRefreshTokens {
  rows: RefreshRow[] = [];
  private sequence = 0;

  private matches(row: RefreshRow, where: Where): boolean {
    if (where.id !== undefined && row.id !== where.id) return false;
    if (where.userId !== undefined && row.userId !== where.userId) return false;
    if (where.jti !== undefined && row.jti !== where.jti) return false;
    if (where.familyId !== undefined && row.familyId !== where.familyId) {
      return false;
    }
    // `revokedAt: null` is the condition the whole design rests on: still live.
    if (where.revokedAt === null && row.revokedAt !== null) return false;

    return true;
  }

  async findUnique(args: { where: Where; select?: Record<string, true> }) {
    const row = this.rows.find((candidate) =>
      this.matches(candidate, args.where),
    );
    if (!row) return null;

    if (!args.select) return { ...row };

    const picked: Record<string, unknown> = {};
    for (const key of Object.keys(args.select)) {
      picked[key] = row[key as keyof RefreshRow];
    }
    return picked;
  }

  async create(args: { data: Record<string, unknown> }) {
    const row = {
      id: `rt-new-${++this.sequence}`,
      revokedAt: null,
      ...args.data,
    } as unknown as RefreshRow;

    this.rows.push(row);
    return { ...row };
  }

  async update(args: { where: { id: string }; data: Partial<RefreshRow> }) {
    const row = this.rows.find((candidate) => candidate.id === args.where.id);
    if (!row) throw new Error('fake: no such refresh token');

    Object.assign(row, args.data);
    return { ...row };
  }

  async updateMany(args: { where: Where; data: Partial<RefreshRow> }) {
    const targets = this.rows.filter((row) => this.matches(row, args.where));
    for (const row of targets) Object.assign(row, args.data);

    return { count: targets.length };
  }

  async count(args: { where: Where }) {
    return this.rows.filter((row) => this.matches(row, args.where)).length;
  }

  /** Test helper: put a row in the table directly. */
  seed(row: Partial<RefreshRow> & { id: string }): RefreshRow {
    const seeded: RefreshRow = {
      userId: USER_ID,
      jti: `jti-${row.id}`,
      familyId: FAMILY_ID,
      hashedToken: 'irrelevant-hash',
      deviceId: null,
      deviceName: null,
      userAgent: null,
      ipAddress: null,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      lastUsedAt: new Date(),
      ...row,
    };

    this.rows.push(seeded);
    return seeded;
  }
}

/** Swapped by a test to make `verify` fail, as a forged token would. */
const jwtBehaviour = {
  verify: (): unknown => ({ sub: USER_ID, jti: 'jti-old', type: 'refresh' }),
  sign: (): string => PLAIN_TOKEN,
};

const jwt = {
  sign: () => jwtBehaviour.sign(),
  verify: () => jwtBehaviour.verify(),
};

const config = {
  getOrThrow: (key: string) => {
    const values: Record<string, string> = {
      ACCESS_TOKEN_EXPIRATION: '900000',
      REFRESH_TOKEN_EXPIRATION: '604800000',
      JWT_ACCESS_TOKEN_SECRET: 'access-secret',
      JWT_REFRESH_TOKEN_SECRET: 'refresh-secret',
    };

    const value = values[key];
    if (value === undefined) throw new Error(`fake config is missing ${key}`);

    return value;
  },
  get: () => undefined,
};

function fakeResponse() {
  const setCookies: string[] = [];
  const clearedCookies: string[] = [];

  const response = {
    cookie: (name: string) => {
      setCookies.push(name);
    },
    clearCookie: (name: string) => {
      clearedCookies.push(name);
    },
  } as unknown as Response;

  return { response, setCookies, clearedCookies };
}

function setup() {
  const refreshToken = new FakeRefreshTokens();
  const prisma = {
    refreshToken,
    $transaction: (callback: (tx: unknown) => unknown) => callback(prisma),
  };

  const users = { getUser: () => Promise.resolve({ id: USER_ID }) };

  const service = new AuthService(
    users as unknown as UsersService,
    config as unknown as ConfigService,
    jwt as unknown as JwtService,
    prisma as unknown as PrismaService,
  );

  return { service, table: refreshToken };
}

/** Test helper: one row's `revokedAt`, by id — `undefined` if no such row. */
const revokedAtOf = (table: FakeRefreshTokens, id: string) =>
  table.rows.find((row) => row.id === id)?.revokedAt;

beforeEach(() => {
  jwtBehaviour.verify = () => ({
    sub: USER_ID,
    jti: 'jti-old',
    type: 'refresh',
  });
  jwtBehaviour.sign = () => PLAIN_TOKEN;
});

describe('sign in', () => {
  it('issues a pair, sets both cookies, and stores a hash — not the token', async () => {
    const { service, table } = setup();
    const { response, setCookies } = fakeResponse();

    const result = await service.signin(
      { id: USER_ID } as unknown as User,
      response,
      metadata,
    );

    expect(setCookies).toEqual(['Authentication', 'Refresh']);
    expect(result).toEqual({
      id: USER_ID,
      accessToken: PLAIN_TOKEN,
      refreshToken: PLAIN_TOKEN,
    });
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].familyId).toBeTruthy();
    expect(table.rows[0].hashedToken).not.toBe(PLAIN_TOKEN);
    expect(table.rows[0].revokedAt).toBeNull();
  });
});

describe('rotation', () => {
  it('revokes the old row and puts the new one in the SAME family', async () => {
    const { service, table } = setup();
    table.seed({ id: 'rt-old', jti: 'jti-old' });
    const { response, setCookies } = fakeResponse();

    await service.rotateRefreshToken(
      { id: 'rt-old', familyId: FAMILY_ID, userId: USER_ID },
      response,
      metadata,
    );

    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].revokedAt).toBeInstanceOf(Date);
    expect(table.rows[1].revokedAt).toBeNull();
    expect(table.rows[1].familyId).toBe(FAMILY_ID);
    expect(setCookies).toEqual(['Authentication', 'Refresh']);
  });

  it('accepts a second refresh of the SAME token inside the grace window, same device', async () => {
    const { service, table } = setup();
    // The token was rotated a moment ago: revoked, with the winner's row live.
    table.seed({
      id: 'rt-old',
      jti: 'jti-old',
      revokedAt: new Date(Date.now() - 1_000),
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    });
    table.seed({ id: 'rt-winner' });

    const { response } = fakeResponse();

    await service.rotateRefreshToken(
      { id: 'rt-old', familyId: FAMILY_ID, userId: USER_ID },
      response,
      metadata,
    );

    // The family survives, and the loser got a token of its own.
    expect(table.rows).toHaveLength(3);
    expect(
      table.rows.find((row) => row.id === 'rt-winner')?.revokedAt,
    ).toBeNull();
  });

  it('treats a replay LATER than the window as reuse and kills the family', async () => {
    const { service, table } = setup();
    table.seed({
      id: 'rt-old',
      jti: 'jti-old',
      revokedAt: new Date(Date.now() - 60_000),
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    });
    table.seed({ id: 'rt-winner' });

    const { response } = fakeResponse();

    await expect(
      service.rotateRefreshToken(
        { id: 'rt-old', familyId: FAMILY_ID, userId: USER_ID },
        response,
        metadata,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(table.rows.every((row) => row.revokedAt !== null)).toBe(true);
  });

  it('treats a replay inside the window from ANOTHER device as reuse', async () => {
    const { service, table } = setup();
    table.seed({
      id: 'rt-old',
      jti: 'jti-old',
      revokedAt: new Date(Date.now() - 1_000),
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    });
    table.seed({ id: 'rt-winner' });

    const { response } = fakeResponse();

    await expect(
      service.rotateRefreshToken(
        { id: 'rt-old', familyId: FAMILY_ID, userId: USER_ID },
        response,
        { userAgent: 'agent-B', ipAddress: '10.0.0.9' },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(table.rows.every((row) => row.revokedAt !== null)).toBe(true);
  });

  it('does not resurrect a session after sign-out: revoked with no live sibling', async () => {
    const { service, table } = setup();
    // Everything in the family is revoked, as a sign-out leaves it.
    table.seed({
      id: 'rt-old',
      jti: 'jti-old',
      revokedAt: new Date(Date.now() - 1_000),
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    });

    const { response } = fakeResponse();

    await expect(
      service.rotateRefreshToken(
        { id: 'rt-old', familyId: FAMILY_ID, userId: USER_ID },
        response,
        metadata,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(table.rows.every((row) => row.revokedAt !== null)).toBe(true);
  });
});

describe('verifyRefreshToken', () => {
  it('passes a revoked token through — rotation owns that decision', async () => {
    const { service, table } = setup();
    table.seed({
      id: 'rt-old',
      jti: 'jti-old',
      hashedToken: await argon2.hash(PLAIN_TOKEN),
      revokedAt: new Date(),
    });

    await expect(
      service.verifyRefreshToken(PLAIN_TOKEN, 'jti-old'),
    ).resolves.toMatchObject({ id: 'rt-old' });
  });

  it('answers an unknown token with the session sentence, not a server error', async () => {
    const { service } = setup();

    await expect(
      service.verifyRefreshToken(PLAIN_TOKEN, 'jti-nope'),
    ).rejects.toThrow(ERROR_MESSAGES.notSignedIn);
  });

  it('does NOT disguise a database failure as a bad token', async () => {
    const { service, table } = setup();
    table.findUnique = () => Promise.reject(new Error('database is down'));

    // The original error must surface: the global filter logs it and answers 500,
    // instead of signing the user out over something a retry would fix.
    await expect(
      service.verifyRefreshToken(PLAIN_TOKEN, 'jti-old'),
    ).rejects.toThrow('database is down');
  });
});

describe('sign-out', () => {
  it('revokes the caller’s own token and leaves everybody else’s alone', async () => {
    const { service, table } = setup();
    table.seed({ id: 'rt-mine', jti: 'jti-mine', userId: USER_ID });
    // The same person, a second device: signing out here must not sign them out
    // there — the token being revoked is the one presented, nothing else.
    table.seed({ id: 'rt-other-device', jti: 'jti-other', userId: USER_ID });
    // A different account holding the SAME `jti` as the caller. Impossible to
    // forge, but it is what proves the `userId` in the where-clause does work:
    // without it, this row would be signed out too.
    table.seed({ id: 'rt-theirs', jti: 'jti-mine', userId: 'user-2' });

    // The token that was presented verifies to this `jti` — the default payload
    // says 'jti-old', which matches none of the rows above (that is what made this
    // test fail: it asserted on rows the service was never pointed at).
    jwtBehaviour.verify = () => ({
      sub: USER_ID,
      jti: 'jti-mine',
      type: 'refresh',
    });

    await service.signoutByToken(PLAIN_TOKEN, USER_ID);

    expect(revokedAtOf(table, 'rt-mine')).toBeInstanceOf(Date);
    expect(revokedAtOf(table, 'rt-other-device')).toBeNull();
    expect(revokedAtOf(table, 'rt-theirs')).toBeNull();
  });

  it('signs out every device of the caller, and only the caller', async () => {
    const { service, table } = setup();
    table.seed({ id: 'rt-mine-1', userId: USER_ID });
    table.seed({ id: 'rt-mine-2', userId: USER_ID });
    table.seed({
      id: 'rt-mine-already-out',
      userId: USER_ID,
      revokedAt: new Date(Date.now() - 60_000),
    });
    table.seed({ id: 'rt-theirs', userId: 'user-2' });

    await service.signoutAll(USER_ID);

    expect(revokedAtOf(table, 'rt-mine-1')).toBeInstanceOf(Date);
    expect(revokedAtOf(table, 'rt-mine-2')).toBeInstanceOf(Date);
    expect(revokedAtOf(table, 'rt-theirs')).toBeNull();
  });

  it('ignores junk instead of crashing, and is idempotent on a second call', async () => {
    const { service, table } = setup();
    table.seed({ id: 'rt-mine', jti: 'jti-mine' });

    // A forged or truncated token: verify fails, so there is nothing to revoke —
    // and it must not raise (AUTH-03) or throw on the missing row (AUTH-07).
    jwtBehaviour.verify = () => {
      throw new Error('not a token');
    };

    await expect(
      service.signoutByToken('garbage', USER_ID),
    ).resolves.toBeUndefined();
    expect(table.rows[0].revokedAt).toBeNull();

    jwtBehaviour.verify = () => ({
      sub: USER_ID,
      jti: 'jti-mine',
      type: 'refresh',
    });

    await service.signoutByToken(PLAIN_TOKEN, USER_ID);
    await expect(
      service.signoutByToken(PLAIN_TOKEN, USER_ID),
    ).resolves.toBeUndefined();
    expect(table.rows[0].revokedAt).toBeInstanceOf(Date);
  });
});
