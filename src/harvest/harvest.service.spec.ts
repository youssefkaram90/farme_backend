import { BadRequestException } from '@nestjs/common';
import { HarvestService } from './harvest.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SeasonService } from '../season/season.service';
import { STAGE_SEEDLING } from '../plant-stock/plant-stock.constants';

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
  /** LPM only — how many lines this field was sown with. */
  lines?: number | null;
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
  /** The sector the batch's LPM sowing was made into — its real home. */
  lpmSectorId = 'sec-home';
  tunnels: { id: string; number: string; seasonId: string }[] = [];
  sectors: { id: string; seasonId: string; name?: string }[] = [];
  assignments: {
    ssmSowingId: string;
    tunnelId: string;
    numberOfTrays: number;
  }[] = [];

  records: Record<string, unknown>[] = [];
  products: ProductRow[] = [];
  movements: Record<string, unknown>[] = [];

  /** Plant counts taken on the batch. Empty = nothing has been counted. */
  counts: {
    plantStockId: string;
    countType: string;
    location: string | null;
    estimatedPlants: number;
    countDate: Date;
  }[] = [];

  /** Set to prove HARV-02: the stage write fails mid-transaction. */
  stageWriteFails = false;
  rolledBack = false;

  /**
   * Set to prove D7: the compare-and-set loses its race — the shelf changed
   * between the read and the write, which no test can produce by timing alone.
   */
  productChangedUnderneath = false;

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
          ? { seasonId: this.batchSeasonId, sectorId: this.lpmSectorId }
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

  /**
   * The latest count for one (batch, tunnel number) — the measurement the
   * over-harvest guard stands on where one exists (HARV-07).
   */
  plantCount = {
    findFirst: ({
      where,
    }: {
      where: {
        plantStockId: string;
        countType: string;
        location?: string | null;
      };
    }) =>
      Promise.resolve(
        this.counts.find(
          (count) =>
            count.plantStockId === where.plantStockId &&
            count.countType === where.countType &&
            count.location === where.location,
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
      };

      this.products.push(product);
      return Promise.resolve({ ...product });
    },

    findUnique: ({
      where,
    }: {
      where: {
        id?: string;
        seasonId_name_planteCode_plantsPerBox?: {
          seasonId: string;
          name: string;
          planteCode: string;
          plantsPerBox: number;
        };
      };
    }) => {
      // Two shapes reach this: the product behind a harvest (the composite key),
      // and a plain id — how the write-off reads its product back.
      if (where.id != null) {
        return Promise.resolve(
          this.products.find((product) => product.id === where.id) ?? null,
        );
      }

      const key = where.seasonId_name_planteCode_plantsPerBox!;
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

    /**
     * The GUARDED write (D6/D7). The real one re-checks its condition against
     * the row it locks; here the same condition is checked against the row.
     *
     * `count: 0` is how it reports a lost race, which is the whole point of the
     * call: the caller must not go on and record a movement it did not make.
     */
    updateMany: ({
      where,
      data,
    }: {
      where: {
        id: string;
        currentQuantity?: number | { gte?: number; gt?: number };
      };
      data: {
        currentQuantity: number | { decrement?: number; increment?: number };
      };
    }) => {
      if (this.productChangedUnderneath) return Promise.resolve({ count: 0 });

      const product = this.products.find((row) => row.id === where.id);
      if (!product) return Promise.resolve({ count: 0 });

      const condition = where.currentQuantity;
      if (
        typeof condition === 'number' &&
        product.currentQuantity !== condition
      ) {
        return Promise.resolve({ count: 0 });
      }
      if (condition && typeof condition === 'object') {
        if (condition.gte != null && product.currentQuantity < condition.gte) {
          return Promise.resolve({ count: 0 });
        }
        if (condition.gt != null && product.currentQuantity <= condition.gt) {
          return Promise.resolve({ count: 0 });
        }
      }

      const change = data.currentQuantity;
      if (typeof change === 'number') {
        product.currentQuantity = change;
      } else if (change.decrement != null) {
        product.currentQuantity -= change.decrement;
      } else if (change.increment != null) {
        product.currentQuantity += change.increment;
      }

      return Promise.resolve({ count: 1 });
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
    currentStage: STAGE_SEEDLING,
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

const actor = { id: 'user-1', name: 'Krypton' };

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

    await service.createRecord(harvest(), actor);

    // 1 box of 100 plants against an expected 1000: nine tenths still growing.
    expect(db.records).toHaveLength(1);
    expect(db.batch.currentStage).toBe(STAGE_SEEDLING);
  });

  it('closes the batch when the expectation is reached', async () => {
    const { service, db } = setup();

    await service.createRecord(
      harvest({ boxCount: 10, plantsPerBox: 100 }),
      actor,
    );

    expect(db.batch.currentStage).toBe('HARVESTED');
  });

  it('reopens it when that harvest is deleted', async () => {
    const { service, db } = setup();

    await service.createRecord(
      harvest({ boxCount: 10, plantsPerBox: 100 }),
      actor,
    );
    expect(db.batch.currentStage).toBe('HARVESTED');

    await service.deleteRecord('rec-1', actor);

    expect(db.batch.currentStage).toBe(STAGE_SEEDLING);
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

describe('which sector a harvest may touch (HARV-06)', () => {
  /**
   * An LPM batch: sown into a sector, so it has no trays and no tunnel.
   *
   * The tunnel branch always checked that the batch was really in the chosen
   * tunnel; the sector branch only checked that the batch was not a tunnel
   * batch, so the sector was taken on trust. A harvest filed against the wrong
   * sector named the wrong place AND left the batch's own plant-stock figures
   * untouched, because those key on the sector its SOWING names — the harvest
   * existed and the stock went up, but the batch still showed as unharvested.
   */
  function setupSectorHarvest() {
    const { service, db } = setup();

    db.batch.ssmSowingId = null;
    db.batch.lpmSowingId = 'lpm-1';
    db.batch.location = 'Ha4-1';
    db.assignments = [];

    db.sectors.push(
      { id: 'sec-home', seasonId: OPEN_SEASON },
      { id: 'sec-other', seasonId: OPEN_SEASON },
    );

    return { service, db };
  }

  it('refuses a sector the batch was not sown into', async () => {
    const { service, db } = setupSectorHarvest();

    await expect(
      service.createRecord(
        harvest({
          targetType: 'SECTOR',
          sectorId: 'sec-other',
          tunnelId: undefined,
        }) as never,
        actor,
      ),
    ).rejects.toThrow('Batch Krypton (lot L-9) is not in the selected sector.');

    // And nothing was written: the refusal happens before the transaction.
    expect(db.records).toHaveLength(0);
    expect(db.products).toHaveLength(0);
  });

  it('accepts the sector the batch was sown into', async () => {
    const { service, db } = setupSectorHarvest();

    await service.createRecord(
      harvest({
        targetType: 'SECTOR',
        sectorId: 'sec-home',
        tunnelId: undefined,
      }),
      actor,
    );

    expect(db.records).toHaveLength(1);
    expect(db.records[0].sectorId).toBe('sec-home');
  });
});

describe('a harvest may not exceed what is standing (HARV-07)', () => {
  /**
   * The guard refuses rather than clamping — the same choice the rest of this
   * module makes. Without it, finished goods held plants that were never grown,
   * and shipments drew from that pool, so an over-harvest authorised boxes that
   * did not exist.
   *
   * The fixture has no seeds-per-tray, so the forecast comes from the fallback:
   * 10 trays of a 1,000-plant batch = 1,000 plants in T1.
   */
  it('refuses a harvest bigger than the tunnel is expected to yield', async () => {
    const { service, db } = setup();

    await expect(
      service.createRecord(
        harvest({ boxCount: 11, plantsPerBox: 100 }) as never,
        actor,
      ),
    ).rejects.toThrow(
      'Only 1,000 plants of Krypton (lot L-9) are still standing in T1, but this harvest takes 1,100.',
    );

    // Refused before the transaction, so nothing was written.
    expect(db.records).toHaveLength(0);
    expect(db.products).toHaveLength(0);
    expect(db.movements).toHaveLength(0);
  });

  it('allows a harvest that uses exactly what is left', async () => {
    const { service, db } = setup();

    await service.createRecord(
      harvest({ boxCount: 10, plantsPerBox: 100 }),
      actor,
    );

    expect(db.records).toHaveLength(1);
  });

  it('gives each tunnel its own budget (C1)', async () => {
    const { service, db } = setup();

    // 20 trays: 10 already in T1 (see setup), 10 in T2. So 1,000 plants a side.
    db.batch.numberOfTrays = 20;
    db.batch.expectedPlants = 2000;
    db.tunnels.push({ id: 'tun-2', number: 'T2', seasonId: OPEN_SEASON });
    db.assignments.push({
      ssmSowingId: 'ssm-1',
      tunnelId: 'tun-2',
      numberOfTrays: 10,
    });

    await service.createRecord(
      harvest({ boxCount: 10, plantsPerBox: 100 }),
      actor,
    );
    await service.createRecord(
      harvest({ tunnelId: 'tun-2', boxCount: 10, plantsPerBox: 100 }),
      actor,
    );

    expect(db.records).toHaveLength(2);

    // T1 is spent, and finishing it did not touch T2's budget.
    await expect(
      service.createRecord(
        harvest({ boxCount: 1, plantsPerBox: 100 }) as never,
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('raises the ceiling when a count found more plants than forecast', async () => {
    const { service, db } = setup();

    // Above the 1,000 forecast, so refused before anything was counted.
    await expect(
      service.createRecord(
        harvest({ boxCount: 12, plantsPerBox: 100 }) as never,
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    db.counts.push({
      plantStockId: 'batch-1',
      countType: 'TRAY',
      location: 'T1',
      estimatedPlants: 1500,
      countDate: new Date('2026-10-01'),
    });

    // 1,200 now fits: a measurement beats a forecast.
    await service.createRecord(
      harvest({ boxCount: 12, plantsPerBox: 100 }),
      actor,
    );

    expect(db.records).toHaveLength(1);
  });

  it('does not LOWER the ceiling when a count found fewer', async () => {
    const { service, db } = setup();

    db.counts.push({
      plantStockId: 'batch-1',
      countType: 'TRAY',
      location: 'T1',
      estimatedPlants: 600,
      countDate: new Date('2026-10-01'),
    });

    // The screen still shows the forecast, so the forecast is what may be taken
    // — the guard must never refuse below the number the operator was shown.
    await service.createRecord(
      harvest({ boxCount: 10, plantsPerBox: 100 }),
      actor,
    );

    expect(db.records).toHaveLength(1);
  });

  it('ignores a count taken in another tunnel', async () => {
    const { service, db } = setup();

    db.counts.push({
      plantStockId: 'batch-1',
      countType: 'TRAY',
      location: 'T2',
      estimatedPlants: 5000,
      countDate: new Date('2026-10-01'),
    });

    await expect(
      service.createRecord(
        harvest({ boxCount: 11, plantsPerBox: 100 }) as never,
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('a sector is judged on what was counted (HARV-08)', () => {
  /**
   * A sector sowing stores the SEEDS SOWN in `expectedPlants`, so subtracting
   * what has been harvested from it compares plants with seeds. Two things
   * followed: the "still standing" figure was always too generous, and a sector
   * batch could never be finished — it would take harvesting more plants than
   * ever grew.
   *
   * A sector is therefore judged on a COUNT, or not at all. The count walks one
   * metre of a row; the app works a whole line out of it and multiplies by the
   * lines sown.
   */
  const SECTOR = 'sec-home';
  const LINES = 8;
  /** What one line was counted at, in the fixture below. */
  const PER_LINE = 1300;

  function setupField() {
    const { service, db } = setup();

    db.batch.ssmSowingId = null;
    db.batch.lpmSowingId = 'lpm-1';
    db.batch.location = 'Ha4-1';
    db.batch.lines = LINES;
    // The SEED figure, which is not a plants figure: 100,000 seeds, 8 lines.
    db.batch.expectedPlants = 100000;
    db.assignments = [];

    db.sectors.push({ id: SECTOR, seasonId: OPEN_SEASON, name: 'Ha4-1' });

    return { service, db };
  }

  /** A harvest of `boxes` boxes of 100 plants out of the field. */
  const fieldHarvest = (boxes: number) =>
    harvest({
      targetType: 'SECTOR',
      sectorId: SECTOR,
      tunnelId: undefined,
      boxCount: boxes,
      plantsPerBox: 100,
    }) as never;

  const countField = (db: FakeHarvest, location: string) =>
    db.counts.push({
      plantStockId: 'batch-1',
      countType: 'ROW_METRE',
      location,
      estimatedPlants: PER_LINE,
      countDate: new Date('2026-10-01'),
    });

  it('finishes the batch once the counted plants are all harvested', async () => {
    const { service, db } = setupField();
    countField(db, 'Ha4-1');

    // 8 lines x 1,300 a line = 10,400 plants standing.
    await service.createRecord(fieldHarvest(104), actor);

    // Before HARV-08 this needed 100,000 plants, so the batch never finished.
    expect(db.batch.currentStage).toBe('HARVESTED');
  });

  it('refuses a harvest bigger than the field was counted at', async () => {
    const { service, db } = setupField();
    countField(db, 'Ha4-1');

    await expect(
      service.createRecord(fieldHarvest(105), actor),
    ).rejects.toThrow(
      'Only 10,400 plants of Krypton (lot L-9) are still standing in Ha4-1, but this harvest takes 10,500.',
    );

    expect(db.records).toHaveLength(0);
  });

  it('judges nothing where the field has not been counted', async () => {
    const { service, db } = setupField();

    // No count: the seed figure must not be used as if it were plants, so
    // nothing is refused and the stage is left as it is.
    await service.createRecord(fieldHarvest(500), actor);

    expect(db.records).toHaveLength(1);
    expect(db.batch.currentStage).toBe(STAGE_SEEDLING);
  });

  it('ignores a count taken on another sector', async () => {
    const { service, db } = setupField();

    countField(db, 'Ha4-2');

    await service.createRecord(fieldHarvest(500), actor);

    expect(db.records).toHaveLength(1);
  });
});

describe('taking stock back out (D6/D7)', () => {
  /**
   * Both of these read the product and then wrote it back as an ABSOLUTE figure.
   * A shipment has been guarded against exactly that since SHIP-01 — the
   * condition sits in the UPDATE, so the database re-checks it against the row
   * it locks — and these two were the copies that never got the guard.
   *
   * The damage is in the ledger, not just the figure: wherever the amount taken
   * is worked out from a read, two callers arriving together can each record a
   * movement for a drop that only happened once, and then the ledger no longer
   * explains the quantity it exists to explain.
   */
  const stockOf = 1000;

  /** One harvest of 1,000 plants: the shelf both tests below work on. */
  async function harvestThen(service: HarvestService): Promise<void> {
    await service.createRecord(
      harvest({ boxCount: 10, plantsPerBox: 100 }),
      actor,
    );
  }

  it('refuses to delete a harvest when the stock no longer covers it', async () => {
    const { service, db } = setup();

    await harvestThen(service);
    expect(db.products[0].currentQuantity).toBe(stockOf);

    // Since then the boxes have shipped: only 300 are left.
    db.products[0].currentQuantity = 300;

    await expect(service.deleteRecord('rec-1', actor)).rejects.toThrow(
      'Only 300 Krypton are left in stock, but removing this harvest would take out 1,000.',
    );

    // The refusal reads the stock as it is NOW, and undid nothing.
    expect(db.products[0].currentQuantity).toBe(300);
    expect(db.records).toHaveLength(1);
  });

  it('empties the shelf and records exactly one movement', async () => {
    const { service, db } = setup();

    await harvestThen(service);

    const result = await service.writeOffProduct(
      db.products[0].id,
      { reason: 'waste' } as never,
      actor,
    );

    expect(result).toEqual({
      id: db.products[0].id,
      writtenOff: stockOf,
      remaining: 0,
    });
    expect(db.products[0].currentQuantity).toBe(0);
    // One movement in (the harvest), one out (the write-off).
    expect(db.movements).toHaveLength(2);
    expect(db.movements[1]).toMatchObject({
      quantity: -stockOf,
      referenceType: 'writeoff',
    });
  });

  it('refuses a second write-off of an emptied shelf', async () => {
    const { service, db } = setup();

    await harvestThen(service);
    await service.writeOffProduct(
      db.products[0].id,
      { reason: 'waste' } as never,
      actor,
    );

    await expect(
      service.writeOffProduct(
        db.products[0].id,
        { reason: 'waste' } as never,
        actor,
      ),
    ).rejects.toThrow('There is nothing left of Krypton to write off.');

    expect(db.movements).toHaveLength(2);
  });

  it('records nothing when the stock moved while it was being written off', async () => {
    const { service, db } = setup();

    await harvestThen(service);

    // The compare-and-set loses its race: the row changed between the read and
    // the write.
    db.productChangedUnderneath = true;

    await expect(
      service.writeOffProduct(
        db.products[0].id,
        { reason: 'waste' } as never,
        actor,
      ),
    ).rejects.toThrow(
      'The stock of Krypton changed while it was being written off.',
    );

    // Only the harvest's own movement — no write-off line for a drop that never
    // happened.
    expect(db.movements).toHaveLength(1);
    expect(db.products[0].currentQuantity).toBe(stockOf);
  });
});
