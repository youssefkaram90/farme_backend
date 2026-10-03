import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AgriInputsService } from './agri-inputs.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SeasonService } from '../season/season.service';
import type { Actor } from '../common/actor';
import { MovementReason } from '../common/enums/movement-reason.enum';

/**
 * AGRI-02 / AGRI-03 / AGRI-04 — the season's list, its ledger, and the two
 * places where a read-then-write used to be happily wrong.
 *
 * AGRI-03's test is worth reading before the others: the fake writes down the
 * *order* of the calls it receives, so the test can prove the duplicate check
 * happens inside the transaction rather than before it. If somebody moves that
 * check back out, the assertion fails — which is the only way this kind of fix
 * stays fixed.
 *
 * AGRI-02's fake can behave like a movement arriving between the count and the
 * delete: the guarded delete then matches nothing, and the test checks that
 * nothing was deleted and the admin got a sentence instead of silence.
 */

type Row = {
  id: string;
  seasonId: string;
  productId: string;
  currentQuantity: number;
  product: { name: string; unit: string | null };
  season: { code: string };
};

class FakeAgriInputs {
  rows: Row[] = [];
  catalogue: { id: string; name: string }[] = [];
  movements: Record<string, unknown>[] = [];

  /** What the four dependant counts say. */
  children = { movements: 0, operations: 0, planEntries: 0, programEntries: 0 };

  /** A dweller arriving between the count and the delete (AGRI-02). */
  deleteMatchesNothing = false;
  deleted: string[] = [];

  /** Every call in order — see AGRI-03. */
  log: string[] = [];
  rolledBack = false;

  agriInputSeason = {
    findUnique: (args: {
      where: {
        id?: string;
        seasonId_productId?: { seasonId: string; productId: string };
      };
      select?: unknown;
      include?: unknown;
    }) => {
      // `select` is the duplicate check, `include` is the ordinary read.
      this.log.push(args.select ? 'findUnique:select' : 'findUnique:include');

      const key = args.where.seasonId_productId;
      const row = args.where.id
        ? this.rows.find((candidate) => candidate.id === args.where.id)
        : this.rows.find(
            (candidate) =>
              candidate.seasonId === key?.seasonId &&
              candidate.productId === key?.productId,
          );

      return Promise.resolve(row ?? null);
    },

    findMany: (args: { skip?: number; take?: number }) => {
      this.log.push('findMany');
      const rows = [...this.rows];
      const from = args.skip ?? 0;
      const to = args.take === undefined ? rows.length : from + args.take;
      return Promise.resolve(rows.slice(from, to));
    },

    count: () => {
      this.log.push('count');
      return Promise.resolve(this.rows.length);
    },

    create: ({
      data,
    }: {
      data: { seasonId: string; productId: string; currentQuantity: number };
    }) => {
      this.log.push('create');
      const product = this.catalogue.find((p) => p.id === data.productId)!;
      const row: Row = {
        id: `row-${this.rows.length + 1}`,
        seasonId: data.seasonId,
        productId: data.productId,
        currentQuantity: data.currentQuantity,
        product: { name: product.name, unit: 'L' },
        season: { code: '26-27' },
      };
      this.rows.push(row);
      return Promise.resolve(row);
    },

    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: { currentQuantity: { increment: number } };
    }) => {
      const row = this.rows.find((candidate) => candidate.id === where.id)!;
      row.currentQuantity += data.currentQuantity.increment;
      return Promise.resolve({ ...row });
    },

    deleteMany: ({ where }: { where: { id: string } }) => {
      this.log.push('deleteMany');

      const blocked =
        this.deleteMatchesNothing ||
        this.children.movements + this.children.operations > 0 ||
        this.children.planEntries + this.children.programEntries > 0;

      if (blocked) return Promise.resolve({ count: 0 });

      this.rows = this.rows.filter((row) => row.id !== where.id);
      this.deleted.push(where.id);
      return Promise.resolve({ count: 1 });
    },
  };

  agriInputMovement = {
    create: ({ data }: { data: Record<string, unknown> }) => {
      this.movements.push(data);
      return Promise.resolve(data);
    },
    count: () => Promise.resolve(this.children.movements),
  };

  cropOperation = { count: () => Promise.resolve(this.children.operations) };
  cropCarePlanEntry = {
    count: () => Promise.resolve(this.children.planEntries),
  };
  phytosanitaryProgramEntry = {
    count: () => Promise.resolve(this.children.programEntries),
  };

  phytosanitaryProduct = {
    findUnique: ({ where }: { where: { id: string } }) =>
      Promise.resolve(
        this.catalogue.find((product) => product.id === where.id) ?? null,
      ),
  };

  $transaction = async (callback: (tx: FakeAgriInputs) => Promise<unknown>) => {
    const rows = this.rows.map((row) => ({ ...row }));
    const movements = [...this.movements];
    this.log.push('tx');

    try {
      return await callback(this);
    } catch (error) {
      this.rows = rows;
      this.movements = movements;
      this.rolledBack = true;
      throw error;
    }
  };
}

const OPEN_SEASON = 'season-open';

function setup() {
  const db = new FakeAgriInputs();
  db.catalogue.push({ id: 'prod-1', name: 'Copper' });
  db.catalogue.push({ id: 'prod-2', name: 'Sulphur' });

  const seasonService = {
    getActiveSeasonId: () => OPEN_SEASON,
    assertReadable: (seasonId: string | null | undefined) => {
      if (seasonId !== OPEN_SEASON) {
        throw new NotFoundException('This record no longer exists.');
      }
    },
  };

  const service = new AgriInputsService(
    db as unknown as PrismaService,
    seasonService as unknown as SeasonService,
  );

  return { service, db };
}

function given(db: FakeAgriInputs, overrides: Partial<Row> = {}) {
  db.rows.push({
    id: 'row-1',
    seasonId: OPEN_SEASON,
    productId: 'prod-1',
    currentQuantity: 100,
    product: { name: 'Copper', unit: 'L' },
    season: { code: '26-27' },
    ...overrides,
  });
}

const actor = { id: 'user-1', name: 'Krypton' } as Actor;

describe('putting a product on the season’s list (AGRI-03)', () => {
  it('reads the duplicate check inside the transaction', async () => {
    const { service, db } = setup();

    await service.addProduct(
      { productId: 'prod-1', openingQuantity: 5 } as never,
      actor,
    );

    const tx = db.log.indexOf('tx');
    expect(tx).toBeGreaterThanOrEqual(0);
    expect(db.log.indexOf('findUnique:select')).toBeGreaterThan(tx);
    expect(db.log.indexOf('create')).toBeGreaterThan(tx);
  });

  it('refuses a product the season already has, and names it', async () => {
    const { service, db } = setup();
    given(db);

    await expect(
      service.addProduct({ productId: 'prod-1' } as never, actor),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      service.addProduct({ productId: 'prod-1' } as never, actor),
    ).rejects.toThrow('"Copper" is already in this season\'s list.');
  });

  it('records an opening balance as a movement written by hand (AGRI-04)', async () => {
    const { service, db } = setup();

    await service.addProduct(
      { productId: 'prod-1', openingQuantity: 40 } as never,
      actor,
    );

    expect(db.movements[0]).toMatchObject({
      quantity: 40,
      reason: MovementReason.OPENING,
      referenceType: 'manual',
    });
  });

  it('writes no movement for an opening balance of zero', async () => {
    const { service, db } = setup();

    await service.addProduct({ productId: 'prod-1' } as never, actor);

    expect(db.movements).toHaveLength(0);
  });

  it('refuses a negative opening balance', async () => {
    const { service } = setup();

    await expect(
      service.addProduct(
        { productId: 'prod-1', openingQuantity: -1 } as never,
        actor,
      ),
    ).rejects.toThrow('An opening balance cannot be negative.');
  });
});

describe('a movement somebody typed in (AGRI-04)', () => {
  it('writes it as manual and moves the season’s quantity', async () => {
    const { service, db } = setup();
    given(db);

    await service.adjustStock(
      'row-1',
      { quantity: 25, reason: MovementReason.RECEIVED } as never,
      actor,
    );

    expect(db.rows[0].currentQuantity).toBe(125);
    expect(db.movements[0]).toMatchObject({
      quantity: 25,
      reason: MovementReason.RECEIVED,
      referenceType: 'manual',
    });
  });

  it('refuses a quantity of zero', async () => {
    const { service, db } = setup();
    given(db);

    await expect(
      service.adjustStock(
        'row-1',
        { quantity: 0, reason: MovementReason.WASTE } as never,
        actor,
      ),
    ).rejects.toThrow('Enter a quantity.');
  });

  it('refuses `used`: that belongs to a treatment, not to a person', async () => {
    const { service, db } = setup();
    given(db);

    await expect(
      service.adjustStock(
        'row-1',
        { quantity: 5, reason: MovementReason.USED } as never,
        actor,
      ),
    ).rejects.toThrow(
      'What was used is recorded when a treatment is logged, not by hand.',
    );
  });

  it('refuses a reason that only removes stock with a positive quantity', async () => {
    const { service, db } = setup();
    given(db);

    await expect(
      service.adjustStock(
        'row-1',
        { quantity: 5, reason: MovementReason.WASTE } as never,
        actor,
      ),
    ).rejects.toThrow(
      'That reason can only be used to take stock out, not add it.',
    );
  });

  it('refuses a reason that only adds stock with a negative quantity', async () => {
    const { service, db } = setup();
    given(db);

    await expect(
      service.adjustStock(
        'row-1',
        { quantity: -5, reason: MovementReason.RECEIVED } as never,
        actor,
      ),
    ).rejects.toThrow(
      'That reason can only be used to add stock, not take it out.',
    );
  });

  it('refuses a result below zero, and rolls the increment back', async () => {
    const { service, db } = setup();
    given(db, { currentQuantity: 10 });

    await expect(
      service.adjustStock(
        'row-1',
        { quantity: -40, reason: MovementReason.WASTE } as never,
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(db.rolledBack).toBe(true);
    expect(db.rows[0].currentQuantity).toBe(10);
    expect(db.movements).toHaveLength(0);
  });
});

describe('taking a product off the list (AGRI-02)', () => {
  it('refuses when the ledger has movements, naming the season', async () => {
    const { service, db } = setup();
    given(db);
    db.children.movements = 2;

    await expect(service.removeProduct('row-1')).rejects.toThrow(
      '"Copper" already has stock movements in season 26-27, so it cannot be removed from the list.',
    );
  });

  it('refuses when it has been used in a plan, a treatment or the program', async () => {
    const { service, db } = setup();
    given(db);
    db.children.operations = 1;

    await expect(service.removeProduct('row-1')).rejects.toThrow(
      '"Copper" has already been used in a plan, a treatment or the program this season, so it cannot be removed from the list.',
    );
  });

  it('takes nothing away when a movement lands during the delete', async () => {
    const { service, db } = setup();
    given(db);
    // The counts were read a moment ago and found nothing — then a treatment
    // was logged. The guarded delete is what decides, not the counts.
    db.deleteMatchesNothing = true;

    await expect(service.removeProduct('row-1')).rejects.toMatchObject({
      status: 409,
    });

    expect(db.deleted).toEqual([]);
    expect(db.rows).toHaveLength(1);
  });

  it('removes it cleanly when nothing points at it', async () => {
    const { service, db } = setup();
    given(db);

    await expect(service.removeProduct('row-1')).resolves.toEqual({
      removed: true,
    });
    expect(db.deleted).toEqual(['row-1']);
  });
});

describe('reading the list and the ledger (AGRI-04)', () => {
  it('reports another season’s row as missing', async () => {
    const { service, db } = setup();
    given(db, { seasonId: 'season-old' });

    await expect(service.findOne('row-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns a plain array without page parameters, and an envelope with them', async () => {
    const { service, db } = setup();
    given(db);
    given(db, { id: 'row-2', productId: 'prod-2' });

    await expect(service.findAll()).resolves.toHaveLength(2);

    await expect(service.findAll(undefined, '1', '1')).resolves.toMatchObject({
      total: 2,
      page: 1,
      pageSize: 1,
      hasMore: true,
    });
  });
});
