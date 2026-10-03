import { ConflictException, ForbiddenException } from '@nestjs/common';
import { CropCareService } from './crop-care.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SeasonService } from '../season/season.service';
import type { Actor } from '../common/actor';

/**
 * The crop-care rules that were wrong until 2026-10-02/03, one case each.
 *
 * Five of them are about *which season* something belongs to and *whether the
 * work is still open* — the two questions this module got wrong in opposite
 * directions: a treatment could be filed in the open season while eating an
 * older season's chemical (CROP-01), and a plan marked complete could be worked
 * on anyway (CROP-04). Both are the kind of mistake nobody notices until the
 * numbers are being explained to somebody, so both get a test that names the
 * season or the status instead of just checking that something was thrown.
 */

type LocationRow = {
  targetType: string;
  tunnelId: string | null;
  sectorId: string | null;
};

type PlanRow = {
  id: string;
  name: string;
  planType: string;
  status: string;
  seasonId: string;
  locations: LocationRow[];
};

type EntryRow = {
  id: string;
  planId: string;
  status: string;
  quantity: number | null;
  inputSeasonId: string | null;
  notes: string | null;
  executedAt?: Date | null;
  executedBy?: string | null;
};

class FakeCropCare {
  plans: PlanRow[] = [];
  entries: EntryRow[] = [];
  operations: Record<string, unknown>[] = [];
  tunnels: { id: string; seasonId: string }[] = [];
  sectors: { id: string; seasonId: string }[] = [];

  private planOf(planId: string) {
    return this.plans.find((plan) => plan.id === planId)!;
  }

  cropCarePlanEntry = {
    findUnique: (args: { where: { id: string } }) => {
      const entry = this.entries.find((row) => row.id === args.where.id);
      if (!entry) return Promise.resolve(null);

      return Promise.resolve({
        ...entry,
        plan: this.planOf(entry.planId),
        operation:
          this.operations.find(
            (operation) => operation.planEntryId === entry.id,
          ) ?? null,
      });
    },

    /** The claim: `where.status.not` is the condition that decides. */
    updateMany: (args: {
      where: { id: string; status?: { not: string } };
      data: Partial<EntryRow>;
    }) => {
      const entry = this.entries.find((row) => row.id === args.where.id);
      if (!entry) return Promise.resolve({ count: 0 });

      const excluded = args.where.status?.not;
      if (excluded !== undefined && entry.status === excluded) {
        return Promise.resolve({ count: 0 });
      }

      Object.assign(entry, args.data);
      return Promise.resolve({ count: 1 });
    },

    update: (args: { where: { id: string }; data: Partial<EntryRow> }) => {
      const entry = this.entries.find((row) => row.id === args.where.id)!;
      Object.assign(entry, args.data);
      return Promise.resolve({ ...entry });
    },

    delete: (args: { where: { id: string } }) => {
      this.entries = this.entries.filter((row) => row.id !== args.where.id);
      return Promise.resolve({ id: args.where.id });
    },

    count: (args: { where: { planId: string; status?: { not: string } } }) =>
      Promise.resolve(
        this.entries.filter(
          (entry) =>
            entry.planId === args.where.planId &&
            entry.status !== args.where.status?.not,
        ).length,
      ),
  };

  cropOperation = {
    create: (args: { data: Record<string, unknown> }) => {
      // Prisma mints the id; the fake has to as well, because deleting an
      // operation is looked up by it.
      const row = { id: `op-${this.operations.length + 1}`, ...args.data };
      this.operations.push(row);
      return Promise.resolve({ ...row, inputSeason: null });
    },

    findUnique: (args: { where: { id: string } }) => {
      const row = this.operations.find(
        (operation) => operation.id === args.where.id,
      );
      return Promise.resolve(row ? { ...row } : null);
    },

    delete: (args: { where: { id: string } }) => {
      const row = this.operations.find(
        (operation) => operation.id === args.where.id,
      );
      this.operations = this.operations.filter(
        (operation) => operation.id !== args.where.id,
      );
      return Promise.resolve(row ?? { id: args.where.id });
    },
  };

  cropCarePlan = {
    findUnique: (args: { where: { id: string } }) => {
      const plan = this.plans.find((row) => row.id === args.where.id);
      return Promise.resolve(
        plan
          ? {
              ...plan,
              entries: this.entries.filter((e) => e.planId === plan.id),
            }
          : null,
      );
    },

    update: (args: { where: { id: string }; data: { status: string } }) => {
      const plan = this.plans.find((row) => row.id === args.where.id)!;
      plan.status = args.data.status;
      return Promise.resolve({ ...plan });
    },
  };

  tunnel = {
    count: (args: { where: { id: { in: string[] }; seasonId: string } }) =>
      Promise.resolve(
        this.tunnels.filter(
          (tunnel) =>
            args.where.id.in.includes(tunnel.id) &&
            tunnel.seasonId === args.where.seasonId,
        ).length,
      ),
  };

  sector = {
    count: (args: { where: { id: { in: string[] }; seasonId: string } }) =>
      Promise.resolve(
        this.sectors.filter(
          (sector) =>
            args.where.id.in.includes(sector.id) &&
            sector.seasonId === args.where.seasonId,
        ).length,
      ),
  };

  $transaction = (callback: (tx: FakeCropCare) => Promise<unknown>) =>
    callback(this);
}

const OPEN_SEASON = 'season-open';
const OLD_SEASON = 'season-old';

function setup() {
  const db = new FakeCropCare();

  db.plans.push({
    id: 'plan-old',
    name: 'Old plan',
    planType: 'TREATMENT',
    status: 'ACTIVE',
    seasonId: OLD_SEASON,
    // Its own season's tunnel, deliberately: a location from another season is
    // refused now (CROP-05).
    locations: [{ targetType: 'TUNNEL', tunnelId: 'tun-old', sectorId: null }],
  });
  db.plans.push({
    id: 'plan-done',
    name: 'Finished plan',
    planType: 'TREATMENT',
    status: 'COMPLETED',
    seasonId: OPEN_SEASON,
    locations: [{ targetType: 'TUNNEL', tunnelId: 'tun-open', sectorId: null }],
  });

  db.entries.push({
    id: 'entry-old',
    planId: 'plan-old',
    status: 'PLANNED',
    quantity: null,
    inputSeasonId: null,
    notes: null,
  });
  db.entries.push({
    id: 'entry-done',
    planId: 'plan-done',
    status: 'PLANNED',
    quantity: null,
    inputSeasonId: null,
    notes: null,
  });

  db.tunnels.push({ id: 'tun-open', seasonId: OPEN_SEASON });
  db.tunnels.push({ id: 'tun-old', seasonId: OLD_SEASON });

  const dated: string[] = [];
  const seasonService = {
    getActiveSeasonId: () => OPEN_SEASON,
    assertDateInSeason: (date: Date, label: string, seasonId?: string) => {
      dated.push(seasonId ?? OPEN_SEASON);
      return Promise.resolve();
    },
  };

  const service = new CropCareService(
    db as unknown as PrismaService,
    seasonService as unknown as SeasonService,
  );

  return { service, db, dated };
}

const actor = { id: 'user-1', name: 'Krypton' } as Actor;

const execute = (overrides: Record<string, unknown> = {}) => ({
  performedAt: '2026-10-03',
  ...overrides,
});

describe('executing a planned care entry', () => {
  it('files the operation in the plan’s season, not the open one (CROP-01)', async () => {
    const { service, db, dated } = setup();

    await service.executePlanEntry('entry-old', execute(), actor);

    expect(db.operations[0]).toMatchObject({ seasonId: OLD_SEASON });
    expect(dated).toEqual([OLD_SEASON]);
  });

  it('refuses an entry of a plan that is marked complete (CROP-04)', async () => {
    const { service } = setup();

    await expect(
      service.executePlanEntry('entry-done', execute(), actor),
    ).rejects.toThrow(
      'This plan is marked complete. Reopen it before executing an entry.',
    );
  });

  it('claims the entry, with one operation behind it (CROP-03)', async () => {
    const { service, db } = setup();

    await service.executePlanEntry('entry-done', execute(), actor);

    expect(db.entries[1]).toMatchObject({
      status: 'EXECUTED',
      executedBy: 'user-1',
    });
    expect(db.entries[1].executedAt).toBeInstanceOf(Date);
    expect(db.operations).toHaveLength(1);
  });

  it('refuses an entry that is already executed, with a sentence (CROP-03)', async () => {
    const { service, db } = setup();

    await service.executePlanEntry('entry-done', execute(), actor);
    // Reopened afterwards — the entry itself is still done.
    db.plans[1].status = 'ACTIVE';

    await expect(
      service.executePlanEntry('entry-done', execute(), actor),
    ).rejects.toThrow(
      'This plan entry has already been executed. Refresh the page to see it.',
    );
  });
});

describe('deleting', () => {
  it('puts the entry back to planned when its operation is deleted (CROP-02)', async () => {
    const { service, db } = setup();

    await service.executePlanEntry('entry-done', execute(), actor);
    const operationId = db.operations[0].id as string;

    await service.deleteOperation(operationId, actor);

    expect(db.entries[1]).toMatchObject({ status: 'PLANNED' });
    expect(db.entries[1].executedAt ?? null).toBeNull();
  });

  it('refuses to delete an entry that has an operation (CROP-02)', async () => {
    const { service, db } = setup();

    await service.executePlanEntry('entry-done', execute(), actor);

    await expect(service.deletePlanEntry('entry-done')).rejects.toThrow(
      'This plan entry has already been executed. Delete the operation first if it was logged by mistake.',
    );
  });
});

describe('locations (CROP-05)', () => {
  it('refuses a tunnel location with no tunnel', async () => {
    const { service } = setup();

    await expect(
      service.createOperation(
        {
          operationType: 'IRRIGATION',
          performedAt: '2026-10-03',
          locations: [{ targetType: 'TUNNEL' }],
        } as never,
        actor,
      ),
    ).rejects.toThrow('Choose a tunnel for each location you picked.');
  });

  it('refuses a location that is a tunnel and a sector at once', async () => {
    const { service } = setup();

    await expect(
      service.createOperation(
        {
          operationType: 'IRRIGATION',
          performedAt: '2026-10-03',
          locations: [
            { targetType: 'TUNNEL', tunnelId: 'tun-open', sectorId: 'sec-1' },
          ],
        } as never,
        actor,
      ),
    ).rejects.toThrow('A location is either a tunnel or a sector, not both.');
  });

  it('refuses another season’s tunnel', async () => {
    const { service } = setup();

    await expect(
      service.createOperation(
        {
          operationType: 'IRRIGATION',
          performedAt: '2026-10-03',
          locations: [{ targetType: 'TUNNEL', tunnelId: 'tun-old' }],
        } as never,
        actor,
      ),
    ).rejects.toThrow(
      'One of the tunnels you picked is not part of this season. Refresh the page and pick again.',
    );
  });

  it('accepts a tunnel of the same season', async () => {
    const { service, db } = setup();

    await service.createOperation(
      {
        operationType: 'IRRIGATION',
        performedAt: '2026-10-03',
        locations: [{ targetType: 'TUNNEL', tunnelId: 'tun-open' }],
      } as never,
      actor,
    );

    expect(db.operations[0]).toMatchObject({ seasonId: OPEN_SEASON });
  });
});

describe('plan status (CROP-04)', () => {
  it('refuses to complete a plan that still has entries to execute', async () => {
    const { service } = setup();

    await expect(
      service.updatePlanStatus('plan-done', 'COMPLETED', true),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lets an administrator reopen a completed plan, but only to Active', async () => {
    const { service, db } = setup();
    db.entries = db.entries.filter((entry) => entry.id !== 'entry-done');

    // Nothing to reopen *to* except Active.
    await expect(
      service.updatePlanStatus('plan-done', 'DRAFT', true),
    ).rejects.toThrow('A completed plan can only be reopened to Active.');

    await service.updatePlanStatus('plan-done', 'ACTIVE', true);
    expect(db.plans[1].status).toBe('ACTIVE');
  });

  it('refuses to let a non-administrator reopen one', async () => {
    const { service } = setup();

    await expect(
      service.updatePlanStatus('plan-done', 'ACTIVE', false),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
