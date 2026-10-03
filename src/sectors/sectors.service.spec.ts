import { ConflictException, NotFoundException } from '@nestjs/common';
import { SectorsService } from './sectors.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SeasonService } from '../season/season.service';

/**
 * SEC-01 / SEC-02 / TUN-03's twin — the sector half of the same rules.
 *
 * Deleting a sector used to succeed always: the cascades took the harvest
 * records and the crop care with it, and both `SowingLPM` and `SowingPlanEntry`
 * were silently detached from the sector they were sown in. The guard refuses
 * and names what is in the way, and the list now counts what the guard counts —
 * a sector that was only ever planned for used to look free on the screen.
 */

type Counts = {
  lpmSowings: number;
  sowingPlanEntries: number;
  harvestRecords: number;
  cropOperationLocations: number;
  cropCarePlanLocations: number;
};

type SectorRow = {
  id: string;
  name: string;
  location: string | null;
  seasonId: string;
};

class FakeSectors {
  sectors: SectorRow[] = [];
  counts!: Counts;
  deleted: string[] = [];

  sector = {
    findUnique: ({ where }: { where: { id: string } }) => {
      const row = this.sectors.find((sector) => sector.id === where.id);
      return Promise.resolve(row ? { ...row, _count: this.counts } : null);
    },

    findFirst: ({
      where,
    }: {
      where: {
        seasonId: string;
        name: string;
        location: string | null;
        id?: { not: string };
      };
    }) =>
      Promise.resolve(
        this.sectors.find(
          (sector) =>
            sector.seasonId === where.seasonId &&
            sector.name === where.name &&
            sector.location === where.location &&
            sector.id !== where.id?.not,
        ) ?? null,
      ),

    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<SectorRow>;
    }) => {
      const row = this.sectors.find((sector) => sector.id === where.id)!;
      Object.assign(row, data);
      return Promise.resolve({ ...row });
    },

    delete: ({ where }: { where: { id: string } }) => {
      this.deleted.push(where.id);
      this.sectors = this.sectors.filter((sector) => sector.id !== where.id);
      return Promise.resolve({ id: where.id });
    },
  };
}

function setup(counts: Partial<Counts> = {}) {
  const db = new FakeSectors();
  db.sectors.push({
    id: 'sec-1',
    name: 'Hassan 1',
    location: 'Hassan',
    seasonId: 'season-open',
  });
  db.counts = {
    lpmSowings: 0,
    sowingPlanEntries: 0,
    harvestRecords: 0,
    cropOperationLocations: 0,
    cropCarePlanLocations: 0,
    ...counts,
  };

  const service = new SectorsService(
    db as unknown as PrismaService,
    { getActiveSeasonId: () => 'season-open' } as unknown as SeasonService,
  );

  return { service, db };
}

describe('deleting a sector', () => {
  it('refuses one that is still in use, and says what uses it', async () => {
    const { service, db } = setup({
      lpmSowings: 3,
      sowingPlanEntries: 1,
      harvestRecords: 2,
    });

    await expect(service.remove('sec-1')).rejects.toThrow(
      'Sector Hassan 1 is still used by 3 sowings, 1 plan entry and 2 harvest records, so it cannot be deleted — the history would go with it.',
    );
    expect(db.deleted).toEqual([]);
  });

  it('refuses a sector that was only ever planned for (SEC-02)', async () => {
    const { service } = setup({ sowingPlanEntries: 2 });

    await expect(service.remove('sec-1')).rejects.toThrow(
      'Sector Hassan 1 is still used by 2 plan entries, so it cannot be deleted — the history would go with it.',
    );
  });

  it('deletes one that nothing points at', async () => {
    const { service, db } = setup();

    await service.remove('sec-1');

    expect(db.deleted).toEqual(['sec-1']);
  });

  it('still reports a sector that is already gone', async () => {
    const { service } = setup();

    await expect(service.remove('sec-gone')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('editing a sector', () => {
  it('compares the location the sector already has when none is sent', async () => {
    const { service } = setup();

    // Only the name changes; the location in the clash check must be the
    // sector's own "Hassan", not `null`.
    await expect(
      service.update('sec-1', { name: 'Hassan 1b' }),
    ).resolves.toMatchObject({
      id: 'sec-1',
      name: 'Hassan 1b',
      location: 'Hassan',
    });
  });

  it('refuses a name another sector in the same season and location has', async () => {
    const { service, db } = setup();
    db.sectors.push({
      id: 'sec-2',
      name: 'Hassan 1b',
      location: 'Hassan',
      seasonId: 'season-open',
    });

    await expect(
      service.update('sec-1', { name: 'Hassan 1b' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows the same name in a different location', async () => {
    const { service, db } = setup();
    db.sectors.push({
      id: 'sec-2',
      name: 'Hassan 1b',
      location: 'Hassan',
      seasonId: 'season-open',
    });

    await expect(
      service.update('sec-1', { name: 'Hassan 1b', location: 'Sidi' }),
    ).resolves.toMatchObject({ id: 'sec-1', location: 'Sidi' });
  });
});
