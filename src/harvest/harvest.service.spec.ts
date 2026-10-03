import { BadRequestException } from '@nestjs/common';
import { HarvestService } from './harvest.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SeasonService } from '../season/season.service';
import type { Actor } from '../common/actor';

/**
 * HARV-01 / HARV-02 / HARV-03 — how much is left of a batch, and which season
 * it belongs to.
 *
 * HARV-01 is the one worth reading twice: a batch that does not record a
 * seeds-per-tray used to expect *zero* plants from a tunnel, so the first
 * harvest of any size looked like a full one, closed the batch, and deleting
 * that harvest reopened it. Every figure downstream followed — a batch with
 * plants still growing in it reported itself finished. The fake batch below
 * deliberately has no seeds-per-tray, because that is the case that was broken.
 *
 * HARV-02 is proved with a rollback: if the stage write fails, the harvest must
 * not be there either.
 */

type BatchRow = {
  id: string;
  variety: string;
  code: number | null;
  location: string;
  lotNumber: string;
  stockType: string;
  numberOfTrays: number | null;
  seedsPerTray: number | null;
  expectedPlants: number;
  currentStage: string;
  ssmSowingId: string | null;
  lpmSowingId?: string | null;
};

type ProductRow = {
  id: string;
  seasonId: string;
  name: string;
  planteCode: string;
  plantsPerBox: number;
  currentQuantity: number;
};

class FakeHarvest {
  batch!: BatchRow;
  /** The season the batch's sowing belongs to. */
  batchSeasonId = 'season-open';
  tunnels: { id: string; number: string; seasonId: string }[] = [];
  sectors: { id: string; seasonId: string }[] = [];
  assignments: {
    ssmSowingId: string;
    tunnelId: string;
    numberOfTrays: number;
  }[] = [];

  records: Record<string, unknown>[] = [];
  products: ProductRow[] = [];
  movements: Record<string, unknown>[] = [];

  /** Set to prove HARV-02: the stage write fails mid-transaction. */
  stageWriteFails = false;
  rolledBack = false;

  plantStock = {
    findUnique: ({ where }: { where: { id: string } }) => {
      if (where.id !== this.batch.id) return Promise.resolve(null);

      return Promise.resolve({
        ...this.batch,
        ssmSowing: this.batch.ssmSowingId
          ? {
              seasonId: this.batchSeasonId,
              tunnelAssignments: this.assignments.map((assignment) => ({
                ...assignment,
                tunnel: this.tunnels.find(
                  (tunnel) => tunnel.id === assignment.tunnelId,
                ),
              })),
            }
          : null,
        lpmSowing: this.batch.lpmSowingId
          ? { seasonId: this.batchSeasonId }
          : null,
      });
    },

    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: { currentStage?: string };
    }) => {
      if (this.stageWriteFails) {
        throw new Error('the stage write failed');
      }

      if (where.id === this.batch.id && data.currentStage) {
        this.batch.currentStage = data.currentStage;
      }

      return Promise.resolve({ ...this.batch });
    },
  };

  tunnel = {
    findUnique: ({ where }: { where: { id: string } }) =>
      Promise.resolve(this.tunnels.find((t) => t.id === where.id) ?? null),
  };

  sector = {
    findUnique: ({ where }: { where: { id: string } }) =>
      Promise.resolve(this.sectors.find((s) => s.id === where.id) ?? null),
  };

  sowingTunnelAssignment = {
    findFirst: ({
      where,
    }: {
      where: { ssmSowingId: string; tunnelId: string };
    }) =>
      Promise.resolve(
        this.assignments.find(
          (assignment) =>
            assignment.ssmSowingId === where.ssmSowingId &&
            assignment.tunnelId === where.tunnelId,
        ) ?? null,
      ),
  };

  harvestRecord = {
    create: ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `rec-${this.records.length + 1}`, ...data };
      this.records.push(row);
      return Promise.resolve(row);
    },

    findUnique: ({ where }: { where: { id: string } }) =>
      Promise.resolve(
        this.records.find((record) => record.id === where.id) ?? null,
      ),

    delete: ({ where }: { where: { id: string } }) => {
      this.records = this.records.filter((record) => record.id !== where.id);
      return Promise.resolve({ id: where.id });
    },

    aggregate: ({
      where,
    }: {
      where: {
        plantStockId: string;
        tunnelId: string | null;
        sectorId: string | null;
      };
    }) =>
      Promise.resolve({
        _sum: {
          totalPlants: this.records
            .filter(
              (record) =>
                record.plantStockId === where.plantStockId &&
                (record.tunnelId ?? null) === where.tunnelId &&
                (record.sectorId ?? null) === where.sectorId,
            )
            .reduce((sum, record) => sum + Number(record.totalPlants ?? 0), 0),
        },
      }),
  };

  harvestedProduct = {
    upsert: ({
      where,
      update,
      create,
    }: {
      where: {
        seasonId_name_planteCode_plantsPerBox: {
          seasonId: string;
          name: string;
          planteCode: string;
          plantsPerBox: number;
        };
      };
      update: { currentQuantity: { increment: number } };
      create: Record<string, unknown>;
    }) => {
      const key = where.seasonId_name_planteCode_plantsPerBox;
      const existing = this.products.find(
        (product) =>
          product.seasonId === key.seasonId &&
          product.name === key.name &&
          product.planteCode === key.planteCode &&
          product.plantsPerBox === key.plantsPerBox,
      );

      if (existing) {
        existing.currentQuantity += update.currentQuantity.increment;
        return Promise.resolve({ ...existing });
      }

      const product: ProductRow = {
        id: `prod-${this.products.length + 1}`,
        seasonId: key.seasonId,
        name: key.name,
        planteCode: key.planteCode,
        plantsPerBox: key.plantsPerBox,
        currentQuantity: 0,
        ...(create as object),
      } as ProductRow;

      this.products.push(product);
      return Promise.resolve({ ...product });
    },

    findUnique: ({
      where,
    }: {
      where: {
        seasonId_name_planteCode_plantsPerBox: {
          seasonId: string;
          name: string;
          planteCode: string;
          plantsPerBox: number;
        };
      };
    }) => {
      const key = where.seasonId_name_planteCode_plantsPerBox;
      return Promise.resolve(
        this.products.find(
          (product) =>
            product.seasonId === key.seasonId &&
            product.name === key.name &&
            product.planteCode === key.planteCode &&
            product.plantsPerBox === key.plantsPerBox,
        ) ?? null,
      );
    },

    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: { currentQuantity: number };
    }) => {
      const product = this.products.find((row) => row.id === where.id)!;
      product.currentQuantity = data.currentQuantity;
      return Promise.resolve({ ...product });
    },
  };

  harvestStockMovement = {
    create: ({ data }: { data: Record<string, unknown> }) => {
      this.movements.push(data);
      return Promise.resolve(data);
    },
  };

  $transaction = async (callback: (tx: FakeHarvest) => Promise<unknown>) => {
    // Snapshot everything the callback can touch, and put it back if it throws.
    const records = [...this.records];
    const products = this.products.map((product) => ({ ...product }));
    const movements = [...this.movements];
    const stage = this.batch.currentStage;

    try {
      return await callback(this);
    } catch (error) {
      this.records = records;
      this.products = products;
      this.movements = movements;
      this.batch.currentStage = stage;
      this.rolledBack = true;
      throw error;
    }
  };
}

const OPEN_SEASON = 'season-open';
const TUNNEL_ID = 'tun-1';

function setup() {
  const db = new FakeHarvest();

  db.batch = {
    id: 'batch-1',
    variety: 'Krypton',
    code: 12,
    location: 'T1',
    lotNumber: 'L-9',
    stockType: 'CVT',
    // The broken case, on purpose: no seeds per tray.
    seedsPerTray: null,
    numberOfTrays: 10,
    expectedPlants: 1000,
    currentStage: 'GROWING',
    ssmSowingId: 'ssm-1',
  };

  db.tunnels.push({ id: TUNNEL_ID, number: 'T1', seasonId: OPEN_SEASON });
  db.assignments.push({
    ssmSowingId: 'ssm-1',
    tunnelId: TUNNEL_ID,
    numberOfTrays: 10,
  });

  const seasonService = {
    getActiveSeasonId: () => OPEN_SEASON,
    assertDateInSeason: () => Promise.resolve(),
    assertReadable: () => undefined,
  };

  const service = new HarvestService(
    db as unknown as PrismaService,
    seasonService as unknown as SeasonService,
  );

  return { service, db };
}

const actor = { id: 'user-1', name: 'Krypton' } as Actor;

const harvest = (overrides: Record<string, unknown> = {}) => ({
  plantStockId: 'batch-1',
  productName: 'Krypton',
  targetType: 'TUNNEL' as const,
  tunnelId: TUNNEL_ID,
  stockType: 'CVT',
  boxCount: 1,
  plantsPerBox: 100,
  harvestedAt: '2026-10-03',
  ...overrides,
});

describe('the batch stage follows what is left (HARV-01)', () => {
  it('does not close a batch that had no seeds per tray, on a small harvest', async () => {
    const { service, db } = setup();

    await service.createRecord(harvest() as never, actor);

    // 1 box of 100 plants against an expected 1000: nine tenths still growing.
    expect(db.records).toHaveLength(1);
    expect(db.batch.currentStage).toBe('GROWING');
  });

  it('closes the batch when the expectation is reached', async () => {
    const { service, db } = setup();

    await service.createRecord(
      harvest({ boxCount: 10, plantsPerBox: 100 }) as never,
      actor,
    );

    expect(db.batch.currentStage).toBe('HARVESTED');
  });

  it('reopens it when that harvest is deleted', async () => {
    const { service, db } = setup();

    await service.createRecord(
      harvest({ boxCount: 10, plantsPerBox: 100 }) as never,
      actor,
    );
    expect(db.batch.currentStage).toBe('HARVESTED');

    await service.deleteRecord('rec-1', actor);

    expect(db.batch.currentStage).toBe('READY');
    expect(db.records).toHaveLength(0);
  });
});

describe('the harvest and the stage move together (HARV-02)', () => {
  it('saves neither when the stage write fails', async () => {
    const { service, db } = setup();
    db.stageWriteFails = true;

    await expect(
      service.createRecord(harvest() as never, actor),
    ).rejects.toThrow('the stage write failed');

    expect(db.rolledBack).toBe(true);
    expect(db.records).toHaveLength(0);
    expect(db.products).toHaveLength(0);
    expect(db.movements).toHaveLength(0);
  });
});

describe('which season a harvest may touch (HARV-03)', () => {
  it('refuses a batch whose sowing belongs to a closed season', async () => {
    const { service, db } = setup();
    db.batchSeasonId = 'season-old';

    await expect(
      service.createRecord(harvest() as never, actor),
    ).rejects.toThrow('That batch belongs to a season that is already closed.');
  });

  it('refuses a tunnel from another season', async () => {
    const { service, db } = setup();
    db.tunnels[0].seasonId = 'season-old';

    await expect(
      service.createRecord(harvest() as never, actor),
    ).rejects.toThrow(
      'That tunnel is not part of the open season. Pick the tunnel again.',
    );
  });

  it('refuses a tunnel that does not exist', async () => {
    const { service } = setup();

    await expect(
      service.createRecord(harvest({ tunnelId: 'tun-gone' }) as never, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
