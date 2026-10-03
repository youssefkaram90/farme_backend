import { ConflictException, NotFoundException } from '@nestjs/common';
import { TrucksService } from './trucks.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SeasonService } from '../season/season.service';
import { normalizePlate } from '../common/normalize-name';

/**
 * TRUCK-01 / TRUCK-02 — one trailer is one truck, and a truck belongs to its
 * season.
 *
 * The DTO normalizes a plate before the service ever sees it, so the test starts
 * where the service does: two spellings of one plate (`ab-12-cd` and
 * `AB-12-CD`) are the same string by then, and must be refused as a duplicate
 * rather than stored as a second trailer.
 *
 * The season rule is checked with the real `assertReadable`, not a stub that
 * never fires: another season's truck is a 404, which is what a caller who
 * cannot see that season should get.
 */

type TruckRow = {
  id: string;
  seasonId: string;
  name: string;
  trailerPlateNumber: string;
  truckPlateNumber: string | null;
};

class FakeTrucks {
  trucks: TruckRow[] = [];
  /** What `assertReadable` was asked to judge, so the test can prove it ran. */
  judged: string[] = [];

  truck = {
    findMany: ({ where }: { where: { seasonId: string } }) =>
      Promise.resolve(
        this.trucks.filter((truck) => truck.seasonId === where.seasonId),
      ),

    findUnique: ({ where }: { where: { id: string } }) =>
      Promise.resolve(
        this.trucks.find((truck) => truck.id === where.id) ?? null,
      ),

    findFirst: ({
      where,
    }: {
      where: {
        seasonId: string;
        trailerPlateNumber: string;
        id?: { not: string };
      };
    }) =>
      Promise.resolve(
        this.trucks.find(
          (truck) =>
            truck.seasonId === where.seasonId &&
            truck.trailerPlateNumber === where.trailerPlateNumber &&
            truck.id !== where.id?.not,
        ) ?? null,
      ),

    create: ({ data }: { data: TruckRow }) => {
      const row = { id: `truck-${this.trucks.length + 1}`, ...data };
      this.trucks.push(row);
      return Promise.resolve({ ...row });
    },

    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<TruckRow>;
    }) => {
      const row = this.trucks.find((truck) => truck.id === where.id)!;
      Object.assign(row, data);
      return Promise.resolve({ ...row });
    },
  };
}

const OPEN_SEASON = 'season-open';

function setup() {
  const db = new FakeTrucks();
  db.trucks.push({
    id: 'truck-1',
    seasonId: OPEN_SEASON,
    name: 'Truck 3',
    trailerPlateNumber: 'AB-12-CD',
    truckPlateNumber: null,
  });
  db.trucks.push({
    id: 'truck-old',
    seasonId: 'season-old',
    name: 'Last year',
    trailerPlateNumber: 'ZZ-99-ZZ',
    truckPlateNumber: null,
  });

  const seasonService = {
    getActiveSeasonId: () => OPEN_SEASON,
    assertReadable: (seasonId: string | null | undefined) => {
      db.judged.push(seasonId ?? 'none');
      if (seasonId !== OPEN_SEASON) {
        throw new NotFoundException('This record no longer exists.');
      }
    },
  };

  const service = new TrucksService(
    db as unknown as PrismaService,
    seasonService as unknown as SeasonService,
  );

  return { service, db };
}

describe('the same trailer twice (TRUCK-02)', () => {
  it('refuses a plate already on another truck, and names that truck', async () => {
    const { service } = setup();

    await expect(
      service.create({
        name: 'Truck 4',
        trailerPlateNumber: 'AB-12-CD',
      } as never),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      service.create({
        name: 'Truck 4',
        trailerPlateNumber: 'AB-12-CD',
      } as never),
    ).rejects.toThrow('Trailer AB-12-CD is already on Truck 3.');
  });

  it('refuses the plate the DTO would have normalized into the same string', async () => {
    const { service, db } = setup();

    // What `@NormalizePlate` does, done by hand: the service sees one string.
    await expect(
      service.create({
        name: 'Truck 4',
        trailerPlateNumber: normalizePlate('  ab-12-cd '),
      } as never),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(db.trucks).toHaveLength(2);
  });

  it('accepts a plate nothing else has', async () => {
    const { service, db } = setup();

    await service.create({
      name: 'Truck 4',
      trailerPlateNumber: normalizePlate('cd-34-ef'),
    } as never);

    expect(db.trucks).toHaveLength(3);
  });

  it('does not clash with itself when the plate is re-sent unchanged', async () => {
    const { service } = setup();

    await expect(
      service.update('truck-1', { trailerPlateNumber: 'AB-12-CD' } as never),
    ).resolves.toMatchObject({ id: 'truck-1' });
  });
});

describe('which season a truck belongs to (TRUCK-01)', () => {
  it('reports another season’s truck as missing, and asks the season service', async () => {
    const { service, db } = setup();

    await expect(service.findOne('truck-old')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(db.judged).toContain('season-old');
  });

  it('judges the truck’s own season on update and remove too', async () => {
    const { service, db } = setup();

    await expect(
      service.update('truck-old', { name: 'Last year' } as never),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(service.remove('truck-old')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(db.judged).toEqual(['season-old', 'season-old']);
  });
});
