import { ConflictException, NotFoundException } from '@nestjs/common';
import { TunnelsService } from './tunnels.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SeasonService } from '../season/season.service';

/**
 * TUN-01 / TUN-02 — what deleting or editing a tunnel is allowed to do.
 *
 * The delete used to succeed every time, and the schema answered the question
 * for us: the cascades took the tunnel's transport assignments, its crop care
 * and — the dangerous one — its harvest records with it, while sowings were
 * quietly detached and the stock kept the quantities it was booked with.
 * Nothing was said, and nothing could be undone.
 *
 * So the guard is the only thing between a mis-tap on a phone and a season's
 * history, and the sentence it says is part of the behaviour: a test that only
 * checked "it throws" would pass for any wording at all.
 */

type Counts = {
  ssmSowings: number;
  sowingTunnelAssignments: number;
  harvestRecords: number;
  cropOperationLocations: number;
  cropCarePlanLocations: number;
};

type TunnelRow = {
  id: string;
  number: string;
  seasonId: string;
  capacity: number;
};

class FakeTunnels {
  tunnels: TunnelRow[] = [];
  counts!: Counts;
  deleted: string[] = [];

  tunnel = {
    /** Both the row lookups and the delete guard go through here. */
    findUnique: ({ where }: { where: { id: string } }) => {
      const row = this.tunnels.find((tunnel) => tunnel.id === where.id);
      return Promise.resolve(row ? { ...row, _count: this.counts } : null);
    },

    findFirst: ({
      where,
    }: {
      where: { seasonId: string; number: string; id?: { not: string } };
    }) =>
      Promise.resolve(
        this.tunnels.find(
          (tunnel) =>
            tunnel.seasonId === where.seasonId &&
            tunnel.number === where.number &&
            tunnel.id !== where.id?.not,
        ) ?? null,
      ),

    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<TunnelRow>;
    }) => {
      const row = this.tunnels.find((tunnel) => tunnel.id === where.id)!;
      Object.assign(row, data);
      return Promise.resolve({ ...row });
    },

    delete: ({ where }: { where: { id: string } }) => {
      this.deleted.push(where.id);
      this.tunnels = this.tunnels.filter((tunnel) => tunnel.id !== where.id);
      return Promise.resolve({ id: where.id });
    },
  };
}

function setup(counts: Partial<Counts> = {}) {
  const db = new FakeTunnels();
  db.tunnels.push({
    id: 'tun-1',
    number: 'T3',
    seasonId: 'season-open',
    capacity: 100,
  });
  db.tunnels.push({
    id: 'tun-2',
    number: 'T4',
    seasonId: 'season-closed',
    capacity: 50,
  });
  db.counts = {
    ssmSowings: 0,
    sowingTunnelAssignments: 0,
    harvestRecords: 0,
    cropOperationLocations: 0,
    cropCarePlanLocations: 0,
    ...counts,
  };

  const service = new TunnelsService(
    db as unknown as PrismaService,
    { getActiveSeasonId: () => 'season-open' } as unknown as SeasonService,
  );

  return { service, db };
}

describe('deleting a tunnel', () => {
  it('refuses one that is still in use, and says what uses it', async () => {
    const { service, db } = setup({
      ssmSowings: 4,
      harvestRecords: 2,
      sowingTunnelAssignments: 1,
    });

    await expect(service.remove('tun-1')).rejects.toThrow(
      'Tunnel T3 is still used by 4 sowings, 2 harvest records and 1 transport, so it cannot be deleted — the history would go with it.',
    );
    expect(db.deleted).toEqual([]);
  });

  it('names a single user in the singular', async () => {
    const { service } = setup({ harvestRecords: 1 });

    await expect(service.remove('tun-1')).rejects.toThrow(
      'Tunnel T3 is still used by 1 harvest record, so it cannot be deleted — the history would go with it.',
    );
  });

  it('deletes one that nothing points at', async () => {
    const { service, db } = setup();

    await service.remove('tun-1');

    expect(db.deleted).toEqual(['tun-1']);
  });

  it('still reports a tunnel that is already gone', async () => {
    const { service } = setup();

    await expect(service.remove('tun-gone')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('editing a tunnel', () => {
  it('looks for the clash in the tunnel’s own season, not the open one (TUN-02)', async () => {
    const { service } = setup();

    // T4 belongs to the closed season. Renaming it to the open season's T3 is
    // not a clash, and must not be reported as one.
    await expect(
      service.update('tun-2', { number: 'T3' }),
    ).resolves.toMatchObject({ id: 'tun-2', number: 'T3' });
  });

  it('refuses a number that another tunnel in the same season already has', async () => {
    const { service, db } = setup();
    db.tunnels.push({
      id: 'tun-3',
      number: 'T9',
      seasonId: 'season-closed',
      capacity: 10,
    });

    await expect(
      service.update('tun-3', { number: 'T4' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('edits capacity on its own, without a number in the body (TUN-03)', async () => {
    const { service } = setup();

    await expect(
      service.update('tun-1', { capacity: 120 }),
    ).resolves.toMatchObject({ id: 'tun-1', capacity: 120 });
  });
});
