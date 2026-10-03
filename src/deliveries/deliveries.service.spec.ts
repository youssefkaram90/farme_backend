import { ConflictException, NotFoundException } from '@nestjs/common';
import { DeliveriesService } from './deliveries.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { StockService } from '../stock/stock.service';
import type { SeasonService } from '../season/season.service';
import type { Actor } from '../common/actor';

/**
 * DELIV-02 / DELIV-04 / DELIV-07 — what a delivery may do to the stock pool.
 *
 * Three rules, all of which used to be wrong in a way nobody could see:
 *
 * - **DELIV-02** a delivery stops being deletable the moment its stock has been
 *   used, because reversing it would put back seeds that are physically gone.
 *   The test drives the counting fake to prove the refusal names the lot.
 * - **DELIV-04** peat is one pool: the delivery row and the ledger must agree
 *   that a peat lot is `PEAT` / `GENERIC`, whatever BIO/CVT the form sent.
 * - **DELIV-07** the reversal goes back into the **delivery's own season**. This
 *   is the one the stock fake is really for: if the season is dropped, the test
 *   notices, and it is the difference between correcting a closed season and
 *   silently changing the open one's stock.
 */

type LotRow = {
  id: string;
  deliveryId: string;
  lotNumber: string;
  productType: string;
  stockType: string;
  quantity: number;
  productName?: string | null;
  supplierName?: string | null;
  thousandSeedsPerGram?: number | null;
  remark?: string | null;
};

type DeliveryRow = {
  id: string;
  seasonId: string;
  deliveryCode: string;
  deliveryDate: string;
  transport: string | null;
  lots: LotRow[];
};

class FakeDeliveries {
  deliveries: DeliveryRow[] = [];

  /** Stock rows that exist, by `seasonId|productType|lotNumber|stockType`. */
  stockRows = new Map<string, string>();
  /** Movements on that stock row that the delivery did NOT write. */
  usedStock = new Map<string, number>();

  /** Every stock call, in order — the reversal-then-add guarantee needs both. */
  calls: { kind: 'add' | 'remove'; params: Record<string, unknown> }[] = [];
  movementDeletes = 0;
  rolledBack = false;

  private stockKey(where: {
    seasonId: string;
    productType: string;
    lotNumber: string;
    stockType: string;
  }) {
    return [
      where.seasonId,
      where.productType,
      where.lotNumber,
      where.stockType,
    ].join('|');
  }

  delivery = {
    findUnique: ({ where }: { where: { id: string } }) => {
      const row = this.deliveries.find((d) => d.id === where.id);
      return Promise.resolve(
        row ? { ...row, lots: row.lots.map((l) => ({ ...l })) } : null,
      );
    },

    create: ({ data }: { data: Record<string, unknown> }) => {
      const lots = (data.lots as { create: LotRow[] }).create.map(
        (lot, index) => ({
          ...lot,
          id: `${data.deliveryCode}-lot-${index + 1}`,
          deliveryId: String(data.deliveryCode),
        }),
      );

      const row: DeliveryRow = {
        id: `del-${this.deliveries.length + 1}`,
        seasonId: String(data.seasonId),
        deliveryCode: String(data.deliveryCode),
        deliveryDate: String(data.deliveryDate),
        transport: (data.transport as string | null) ?? null,
        lots,
      };

      this.deliveries.push(row);
      return Promise.resolve({ ...row });
    },

    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const row = this.deliveries.find((d) => d.id === where.id)!;

      if (data.deliveryCode !== undefined)
        row.deliveryCode = String(data.deliveryCode);
      if (data.deliveryDate !== undefined)
        row.deliveryDate = String(data.deliveryDate);
      if (data.transport !== undefined)
        row.transport = (data.transport as string | null) ?? null;

      if (data.lots) {
        row.lots = (data.lots as { create: LotRow[] }).create.map(
          (lot, index) => ({
            ...lot,
            id: `${row.deliveryCode}-lot-${index + 1}`,
            deliveryId: row.id,
          }),
        );
      }

      return Promise.resolve({ ...row, lots: row.lots.map((l) => ({ ...l })) });
    },

    delete: ({ where }: { where: { id: string } }) => {
      this.deliveries = this.deliveries.filter((d) => d.id !== where.id);
      return Promise.resolve({ id: where.id });
    },
  };

  deliveryLot = {
    deleteMany: ({ where }: { where: { deliveryId: string } }) => {
      const row = this.deliveries.find((d) => d.id === where.deliveryId);
      const count = row?.lots.length ?? 0;
      if (row) row.lots = [];
      return Promise.resolve({ count });
    },
  };

  stockItem = {
    findUnique: ({
      where,
    }: {
      where: {
        seasonId_productType_stockType_lotNumber: Record<string, string>;
      };
    }) => {
      const key = this.stockKey(
        where.seasonId_productType_stockType_lotNumber as never,
      );
      const id = this.stockRows.get(key);
      return Promise.resolve(id ? { id } : null);
    },
  };

  stockMovement = {
    count: () => Promise.resolve(0 as number),
    deleteMany: () => {
      this.movementDeletes += 1;
      return Promise.resolve({ count: 0 });
    },
  };

  $transaction = async (callback: (tx: FakeDeliveries) => Promise<unknown>) => {
    const deliveries = JSON.parse(JSON.stringify(this.deliveries));

    try {
      return await callback(this);
    } catch (error) {
      this.deliveries = deliveries;
      this.rolledBack = true;
      throw error;
    }
  };
}

const OPEN_SEASON = 'season-open';
const OLD_SEASON = 'season-old';

function setup() {
  const db = new FakeDeliveries();

  const stockService = {
    addStock: (params: Record<string, unknown>) => {
      db.calls.push({ kind: 'add', params });
      return Promise.resolve({});
    },
    removeStock: (params: Record<string, unknown>) => {
      db.calls.push({ kind: 'remove', params });
      return Promise.resolve({});
    },
  };

  const judged: Date[] = [];
  const seasonService = {
    getActiveSeasonId: () => OPEN_SEASON,
    assertDateInSeason: (date: Date) => {
      judged.push(date);
      return Promise.resolve();
    },
  };

  const service = new DeliveriesService(
    db as unknown as PrismaService,
    stockService as unknown as StockService,
    seasonService as unknown as SeasonService,
  );

  return { service, db, judged };
}

const actor = { id: 'user-1', name: 'Krypton' } as Actor;

const delivery = (lots: Record<string, unknown>[]) => ({
  deliveryCode: 'D-1',
  deliveryDate: '2026-10-03',
  transport: 'Truck 3',
  lots,
});

function givenDelivery(db: FakeDeliveries, seasonId = OPEN_SEASON) {
  db.deliveries.push({
    id: 'del-1',
    seasonId,
    deliveryCode: 'D-1',
    deliveryDate: '2026-10-03T00:00:00.000Z',
    transport: 'Truck 3',
    lots: [
      {
        id: 'lot-1',
        deliveryId: 'del-1',
        lotNumber: 'L-9',
        productType: 'SEEDS',
        stockType: 'CVT',
        quantity: 10,
      },
    ],
  });
}

describe('creating a delivery (DELIV-04)', () => {
  it('pools peat into PEAT/GENERIC whatever the form sent', async () => {
    const { service, db } = setup();

    await service.create(
      delivery([
        {
          lotNumber: 'PT-9',
          productType: 'PEAT',
          stockType: 'BIO',
          quantity: 40,
        },
        {
          lotNumber: 'L-9',
          productType: 'SEEDS',
          stockType: 'CVT',
          quantity: 10,
        },
      ]) as never,
      actor,
    );

    // The delivery row and the ledger agree about the same pool.
    expect(db.deliveries[0].lots[0]).toMatchObject({
      lotNumber: 'PEAT',
      stockType: 'GENERIC',
    });
    expect(db.calls[0].params).toMatchObject({
      lotNumber: 'PEAT',
      stockType: 'GENERIC',
      quantity: 40,
      referenceType: 'delivery',
    });
    expect(db.calls[1].params).toMatchObject({
      lotNumber: 'L-9',
      stockType: 'CVT',
    });
  });

  it('judges the delivery date against the season', async () => {
    const { service, judged } = setup();

    await service.create(
      delivery([
        {
          lotNumber: 'L-9',
          productType: 'SEEDS',
          stockType: 'CVT',
          quantity: 1,
        },
      ]) as never,
      actor,
    );

    expect(judged).toHaveLength(1);
    expect(judged[0].toISOString()).toContain('2026-10-03');
  });
});

describe('deleting a delivery whose stock was used (DELIV-02)', () => {
  it('refuses, and names the lot', async () => {
    const { service, db } = setup();
    givenDelivery(db);

    // The pool exists and something other than this delivery has moved it.
    db.stockRows.set(`${OPEN_SEASON}|SEEDS|L-9|CVT`, 'stock-1');
    db.stockMovement.count = () => Promise.resolve(1);

    await expect(service.remove('del-1', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(service.remove('del-1', actor)).rejects.toThrow(
      'Some of this delivery has already been used (lot L-9). It cannot be deleted — correct the quantities, or record a stock adjustment instead.',
    );

    expect(db.deliveries).toHaveLength(1);
    expect(db.calls).toHaveLength(0);
  });

  it('takes the stock back out of the delivery’s own season (DELIV-07)', async () => {
    const { service, db } = setup();
    givenDelivery(db, OLD_SEASON);

    await service.remove('del-1', actor);

    expect(db.calls).toEqual([
      {
        kind: 'remove',
        params: expect.objectContaining({
          lotNumber: 'L-9',
          stockType: 'CVT',
          quantity: 10,
          seasonId: OLD_SEASON,
        }),
      },
    ]);
    expect(db.deliveries).toHaveLength(0);
  });

  it('never deletes from the ledger', async () => {
    const { service, db } = setup();
    givenDelivery(db);

    await service.remove('del-1', actor);

    expect(db.movementDeletes).toBe(0);
  });

  it('reports a delivery that is already gone', async () => {
    const { service } = setup();

    await expect(service.remove('del-gone', actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('editing a delivery (DELIV-03 / DELIV-07)', () => {
  it('reverses the old lots before adding the new ones, in its own season', async () => {
    const { service, db } = setup();
    givenDelivery(db, OLD_SEASON);

    await service.update(
      'del-1',
      delivery([
        {
          lotNumber: 'L-10',
          productType: 'SEEDS',
          stockType: 'BIO',
          quantity: 25,
        },
      ]) as never,
      actor,
    );

    expect(db.calls.map((call) => call.kind)).toEqual(['remove', 'add']);
    expect(db.calls[0].params).toMatchObject({
      lotNumber: 'L-9',
      quantity: 10,
      seasonId: OLD_SEASON,
    });
    expect(db.calls[1].params).toMatchObject({
      lotNumber: 'L-10',
      stockType: 'BIO',
      quantity: 25,
      seasonId: OLD_SEASON,
    });
  });

  it('keeps the code and the transport it was sent (DELIV-03)', async () => {
    const { service, db } = setup();
    givenDelivery(db);

    await service.update(
      'del-1',
      {
        ...delivery([
          {
            lotNumber: 'L-9',
            productType: 'SEEDS',
            stockType: 'CVT',
            quantity: 10,
          },
        ]),
        deliveryCode: 'D-2',
        transport: 'Truck 9',
      } as never,
      actor,
    );

    expect(db.deliveries[0]).toMatchObject({
      deliveryCode: 'D-2',
      transport: 'Truck 9',
    });
  });
});
