import { BadRequestException } from '@nestjs/common';
import { ShipmentsService } from './shipments.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SeasonService } from '../season/season.service';
import type { Actor } from '../common/actor';

/**
 * SHIP-01 / SHIP-02 — what a shipment may take, and from which season.
 *
 * SHIP-01 is the one that matters: the stock was read and checked outside the
 * transaction, so two shipments could pass the same check and drive a pool
 * below zero. The fake below can behave like that second shipment — its guarded
 * `updateMany` reports that it matched nothing — and the test then proves the
 * whole thing rolled back: no shipment row, no ledger lines, and the pool
 * exactly as it was.
 */

type ProductRow = {
  id: string;
  name: string;
  plantsPerBox: number;
  currentQuantity: number;
};

type LineRow = {
  harvestedProductId: string;
  boxCount: number;
  totalPlants: number;
};

class FakeShipments {
  products: ProductRow[] = [];
  truck: { id: string; seasonId: string } | null = null;

  shipments: {
    id: string;
    seasonId: string;
    truckId: string | null;
    lines: LineRow[];
  }[] = [];
  movements: Record<string, unknown>[] = [];

  /**
   * The concurrent-shipment case: the row no longer satisfies the guard when the
   * conditional update runs, so nothing is taken and `count` comes back 0.
   */
  stockTakenElsewhere = false;
  rolledBack = false;

  harvestedProduct = {
    findMany: ({ where }: { where: { id: { in: string[] } } }) =>
      Promise.resolve(this.products.filter((p) => where.id.in.includes(p.id))),

    findUnique: ({ where }: { where: { id: string } }) =>
      Promise.resolve(this.products.find((p) => p.id === where.id) ?? null),

    updateMany: ({
      where,
      data,
    }: {
      where: { id: string; currentQuantity: { gte: number } };
      data: { currentQuantity: { decrement: number } };
    }) => {
      const product = this.products.find((p) => p.id === where.id);

      if (!product) return Promise.resolve({ count: 0 });

      if (this.stockTakenElsewhere) {
        // Someone else got there first — the draw-down happens, but the guard
        // says the row is no longer theirs to take.
        product.currentQuantity -= data.currentQuantity.decrement;
        return Promise.resolve({ count: 0 });
      }

      if (product.currentQuantity < where.currentQuantity.gte) {
        return Promise.resolve({ count: 0 });
      }

      product.currentQuantity -= data.currentQuantity.decrement;
      return Promise.resolve({ count: 1 });
    },
  };

  truck = {
    findUnique: ({ where }: { where: { id: string } }) =>
      Promise.resolve(
        this.truck && this.truck.id === where.id ? { ...this.truck } : null,
      ),
  };

  shipment = {
    create: ({ data }: { data: Record<string, unknown> }) => {
      const lines = (data.lines as { create: LineRow[] }).create;
      const row = {
        id: `ship-${this.shipments.length + 1}`,
        seasonId: data.seasonId as string,
        truckId: (data.truckId as string | undefined) ?? null,
        lines,
      };
      this.shipments.push(row);
      return Promise.resolve(row);
    },
  };

  harvestStockMovement = {
    create: ({ data }: { data: Record<string, unknown> }) => {
      this.movements.push(data);
      return Promise.resolve(data);
    },
  };

  $transaction = async (callback: (tx: FakeShipments) => Promise<unknown>) => {
    const products = this.products.map((product) => ({ ...product }));
    const shipments = [...this.shipments];
    const movements = [...this.movements];

    try {
      return await callback(this);
    } catch (error) {
      this.products = products;
      this.shipments = shipments;
      this.movements = movements;
      this.rolledBack = true;
      throw error;
    }
  };
}

const OPEN_SEASON = 'season-open';

function setup() {
  const db = new FakeShipments();
  db.products.push({
    id: 'prod-1',
    name: 'Krypton',
    plantsPerBox: 100,
    currentQuantity: 1000,
  });
  db.truck = { id: 'truck-1', seasonId: OPEN_SEASON };

  const seasonService = {
    getActiveSeasonId: () => OPEN_SEASON,
    assertDateInSeason: () => Promise.resolve(),
    assertReadable: () => undefined,
  };

  const service = new ShipmentsService(
    db as unknown as PrismaService,
    seasonService as unknown as SeasonService,
  );

  return { service, db };
}

const actor = { id: 'user-1', name: 'Krypton' } as Actor;

const shipment = (overrides: Record<string, unknown> = {}) => ({
  shipmentNumber: 'S-1',
  shipmentDate: '2026-10-03',
  truckId: 'truck-1',
  lines: [{ harvestedProductId: 'prod-1', boxCount: 6 }],
  ...overrides,
});

describe('taking stock out (SHIP-01)', () => {
  it('draws the pool down and writes one ledger line per line', async () => {
    const { service, db } = setup();

    await service.create(shipment() as never, actor);

    expect(db.products[0].currentQuantity).toBe(400);
    expect(db.movements).toHaveLength(1);
    expect(db.shipments).toHaveLength(1);
  });

  it('merges two lines of the same product before drawing anything down', async () => {
    const { service, db } = setup();

    await service.create(
      shipment({
        lines: [
          { harvestedProductId: 'prod-1', boxCount: 3 },
          { harvestedProductId: 'prod-1', boxCount: 3 },
        ],
      }) as never,
      actor,
    );

    // 6 boxes of 100 = 600 taken once, with two ledger lines (one per line).
    expect(db.products[0].currentQuantity).toBe(400);
    expect(db.movements).toHaveLength(2);
  });

  it('takes nothing and leaves nothing behind when the guard does not match', async () => {
    const { service, db } = setup();
    db.stockTakenElsewhere = true;

    await expect(
      service.create(shipment() as never, actor),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(db.rolledBack).toBe(true);
    expect(db.shipments).toHaveLength(0);
    expect(db.movements).toHaveLength(0);
    expect(db.products[0].currentQuantity).toBe(1000);
  });

  it('refuses a product that no longer exists', async () => {
    const { service } = setup();

    await expect(
      service.create(
        shipment({
          lines: [{ harvestedProductId: 'prod-gone', boxCount: 1 }],
        }) as never,
        actor,
      ),
    ).rejects.toThrow('One of the products in this shipment no longer exists.');
  });
});

describe('which season a shipment may name (SHIP-02)', () => {
  it('refuses a truck from another season', async () => {
    const { service, db } = setup();
    db.truck = { id: 'truck-1', seasonId: 'season-old' };

    await expect(service.create(shipment() as never, actor)).rejects.toThrow(
      'That truck is not part of the open season. Pick the truck again.',
    );
  });

  it('accepts a shipment with no truck at all', async () => {
    const { service, db } = setup();

    await service.create(shipment({ truckId: undefined }) as never, actor);

    expect(db.shipments[0].truckId).toBeNull();
  });
});
