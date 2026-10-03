import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StockService } from './stock.service';
import { MovementReason } from '../common/enums/movement-reason.enum';
import { ReferenceType } from './enums/reference-type.enum';
import type { PrismaService } from '../prisma/prisma.service';
import type { SeasonService } from '../season/season.service';

/**
 * Hand-recorded stock adjustments (STOCK-02 / STOCK-05 / STOCK-06).
 *
 * An adjustment is the one place a person changes a quantity by hand — an
 * opening balance, a return, waste, a correction — so every rule about what may
 * be typed lives in one method, and each rule is a sentence somebody will read
 * when they get it wrong.
 *
 * The transaction fake rolls back on a throw, because that is what Postgres
 * does: the refusal has to leave the pool exactly as it found it, and the
 * message has to name a number that is still true.
 */

type Item = { id: string; lotNumber: string; currentQuantity: number };

class FakeStock {
  items: Item[] = [];
  movements: Record<string, unknown>[] = [];

  /** What the transaction restored, so a test can prove the rollback. */
  rolledBack = false;

  stockItem = {
    findUnique: ({ where }: { where: { id: string } }) =>
      Promise.resolve(this.items.find((item) => item.id === where.id) ?? null),

    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: { currentQuantity?: { increment: number } };
    }) => {
      const item = this.items.find((candidate) => candidate.id === where.id)!;
      item.currentQuantity += data.currentQuantity?.increment ?? 0;
      return Promise.resolve({ ...item });
    },
  };

  stockMovement = {
    create: ({ data }: { data: Record<string, unknown> }) => {
      this.movements.push(data);
      return Promise.resolve(data);
    },
  };

  $transaction = async (callback: (tx: FakeStock) => Promise<unknown>) => {
    // Snapshot what the callback can change, and put it back if it throws.
    const snapshot = this.items.map((item) => ({ ...item }));
    const movementsBefore = this.movements.length;

    try {
      return await callback(this);
    } catch (error) {
      this.items = snapshot;
      this.movements = this.movements.slice(0, movementsBefore);
      this.rolledBack = true;
      throw error;
    }
  };
}

function setup() {
  const db = new FakeStock();
  db.items.push({ id: 'item-1', lotNumber: 'A1', currentQuantity: 100 });

  const service = new StockService(
    db as unknown as PrismaService,
    {} as unknown as SeasonService,
  );

  return { service, db };
}

const actor = { name: 'Krypton' };

const adjust = (overrides: Record<string, unknown> = {}) => ({
  stockItemId: 'item-1',
  quantity: 50,
  reason: MovementReason.OPENING,
  note: undefined,
  ...overrides,
});

describe('what an adjustment refuses, and what it says', () => {
  it('refuses a lot that does not exist', async () => {
    const { service } = setup();

    await expect(
      service.adjustStock(adjust({ stockItemId: 'gone' }) as never, actor),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a quantity of zero', async () => {
    const { service } = setup();

    await expect(
      service.adjustStock(adjust({ quantity: 0 }) as never, actor),
    ).rejects.toThrow('Enter a quantity.');
  });

  it('refuses "used" — a treatment writes that, not a person', async () => {
    const { service } = setup();

    await expect(
      service.adjustStock(
        adjust({ reason: MovementReason.USED }) as never,
        actor,
      ),
    ).rejects.toThrow(
      'What was used is recorded when a treatment is logged, not by hand.',
    );
  });

  it('refuses "received" — a delivery writes that', async () => {
    const { service } = setup();

    await expect(
      service.adjustStock(
        adjust({ reason: MovementReason.RECEIVED }) as never,
        actor,
      ),
    ).rejects.toThrow(
      'Seeds and peat arrive on a delivery — record the delivery instead.',
    );
  });

  it('refuses a return or waste that ADDS stock', async () => {
    const { service } = setup();

    for (const reason of [
      MovementReason.RETURNED_TO_CLIENT,
      MovementReason.WASTE,
    ]) {
      await expect(
        service.adjustStock(adjust({ reason, quantity: 10 }) as never, actor),
      ).rejects.toThrow(
        'That reason can only be used to take stock out, not add it.',
      );
    }
  });

  it('refuses a negative opening balance', async () => {
    const { service } = setup();

    await expect(
      service.adjustStock(adjust({ quantity: -10 }) as never, actor),
    ).rejects.toThrow('An opening balance must be a positive quantity.');
  });
});

describe('taking out more than there is', () => {
  it('refuses, and names what is actually left', async () => {
    const { service } = setup();

    await expect(
      service.adjustStock(
        adjust({ quantity: -150, reason: MovementReason.CORRECTION }) as never,
        actor,
      ),
    ).rejects.toThrow('Only 100 of lot A1 is left.');
  });

  it('says so plainly when the pool is already empty', async () => {
    // -20 of a lot is reachable: a sowing is allowed to overrun the pool. "Only
    // -20 is left" is not a sentence, so this branch exists.
    const { service, db } = setup();
    db.items[0].currentQuantity = -20;

    await expect(
      service.adjustStock(
        adjust({ quantity: -10, reason: MovementReason.WASTE }) as never,
        actor,
      ),
    ).rejects.toThrow(
      'Lot A1 has nothing left to take from — it is already at -20.',
    );
  });

  it('leaves the pool exactly as it found it', async () => {
    const { service, db } = setup();

    await expect(
      service.adjustStock(
        adjust({ quantity: -150, reason: MovementReason.CORRECTION }) as never,
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(db.rolledBack).toBe(true);
    expect(db.items[0].currentQuantity).toBe(100);
    expect(db.movements).toEqual([]);
  });
});

describe('an adjustment that is allowed', () => {
  it('moves the quantity and writes one movement against it', async () => {
    const { service, db } = setup();

    const updated = await service.adjustStock(
      adjust({ quantity: 50, note: 'counted at the start' }) as never,
      actor,
    );

    expect(updated.currentQuantity).toBe(150);
    expect(db.movements).toEqual([
      {
        stockItemId: 'item-1',
        quantity: 50,
        referenceType: ReferenceType.MANUAL,
        reason: MovementReason.OPENING,
        note: 'counted at the start',
        createdByName: 'Krypton',
      },
    ]);
  });

  it('records a removal as a negative movement, as typed', async () => {
    const { service, db } = setup();

    await service.adjustStock(
      adjust({ quantity: -30, reason: MovementReason.WASTE }) as never,
      actor,
    );

    expect(db.movements[0]).toMatchObject({
      quantity: -30,
      referenceType: ReferenceType.MANUAL,
      reason: MovementReason.WASTE,
      createdByName: 'Krypton',
    });
    expect(db.items[0].currentQuantity).toBe(70);
  });

  it('stores no note rather than the word "undefined"', async () => {
    const { service, db } = setup();

    await service.adjustStock(adjust({ note: undefined }) as never, actor);

    expect(db.movements[0].note).toBeNull();
  });
});
