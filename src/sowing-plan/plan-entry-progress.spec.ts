import { BadRequestException } from '@nestjs/common';
import { PlanEntryStatus, PlanStatus } from './enums/plan-type.enum';
import {
  assertEntrySowable,
  isFinishedEntry,
  summarisePlanProgress,
  syncPlanEntryProgress,
  type PlanEntryTotals,
} from './plan-entry-progress';
import type { Prisma } from '../generated/prisma/client';

/**
 * The one authority for "how far has this entry got" (SPLAN-01 / 02 / 08).
 *
 * Everything here runs against a fake `tx`: no database, no Docker, no Nest. The
 * point is not coverage for its own sake — it is that four separate defects
 * (an entry stuck at PARTIALLY_EXECUTED for ever, a closed entry that could still
 * be sown, a plan that could never reach 100 %, a percentage bound straight to a
 * CSS width) all lived in this file, and none of them was visible from reading
 * one function in isolation.
 */

type Entry = {
  id: string;
  status: string;
  planType: string;
  plannedTrays: number | null;
  plannedQuantity: number | null;
};

class FakeTx {
  entries: Entry[] = [];
  ssmSowings: { planEntryId: string; numberOfTrays: number }[] = [];
  lpmSowings: { planEntryId: string; quantityUsed: number }[] = [];

  /** Every write the helper made, so a test can look at what it decided. */
  updates: { id: string; data: Record<string, unknown> }[] = [];

  sowingPlanEntry = {
    findUnique: ({ where }: { where: { id: string } }) => {
      const entry = this.entries.find((candidate) => candidate.id === where.id);
      if (!entry) return Promise.resolve(null);

      // The helper reads the plan type through the relation, not off the entry.
      return Promise.resolve({ ...entry, plan: { planType: entry.planType } });
    },

    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      this.updates.push({ id: where.id, data });
      const entry = this.entries.find((candidate) => candidate.id === where.id);
      if (entry) Object.assign(entry, data);
      return Promise.resolve(entry);
    },
  };

  sowingSSM = {
    aggregate: ({ where }: { where: { planEntryId: string } }) => {
      const rows = this.ssmSowings.filter(
        (row) => row.planEntryId === where.planEntryId,
      );

      return Promise.resolve({
        // Prisma answers null, not 0, when nothing matches — and no rows at all
        // is exactly the case the "nothing sown yet" branch depends on.
        _sum: {
          numberOfTrays: rows.length
            ? rows.reduce((sum, row) => sum + row.numberOfTrays, 0)
            : null,
        },
      });
    },
  };

  sowingLPM = {
    aggregate: ({ where }: { where: { planEntryId: string } }) => {
      const rows = this.lpmSowings.filter(
        (row) => row.planEntryId === where.planEntryId,
      );

      return Promise.resolve({
        _sum: {
          quantityUsed: rows.length
            ? rows.reduce((sum, row) => sum + row.quantityUsed, 0)
            : null,
        },
      });
    },
  };
}

const asTx = (fake: FakeTx) => fake as unknown as Prisma.TransactionClient;

function setup() {
  const tx = new FakeTx();
  tx.entries.push({
    id: 'entry-1',
    status: PlanEntryStatus.PLANNED,
    planType: 'SSM',
    plannedTrays: 100,
    plannedQuantity: null,
  });

  return tx;
}

describe('syncPlanEntryProgress', () => {
  it('calls an entry EXECUTED once the sowings reach the plan', async () => {
    const tx = setup();
    tx.ssmSowings.push({ planEntryId: 'entry-1', numberOfTrays: 100 });

    await syncPlanEntryProgress(asTx(tx), 'entry-1');

    expect(tx.updates).toEqual([
      {
        id: 'entry-1',
        data: { executedTrays: 100, status: PlanEntryStatus.EXECUTED },
      },
    ]);
  });

  it('calls it PARTIALLY_EXECUTED when only some was sown', async () => {
    const tx = setup();
    tx.ssmSowings.push({ planEntryId: 'entry-1', numberOfTrays: 40 });

    await syncPlanEntryProgress(asTx(tx), 'entry-1');

    expect(tx.updates[0].data).toMatchObject({
      executedTrays: 40,
      status: PlanEntryStatus.PARTIALLY_EXECUTED,
    });
  });

  it('puts it back to PLANNED when nothing is sown any more', async () => {
    const tx = setup();
    tx.entries[0].status = PlanEntryStatus.PARTIALLY_EXECUTED;
    tx.entries[0].plannedTrays = 100;

    await syncPlanEntryProgress(asTx(tx), 'entry-1');

    expect(tx.updates[0].data).toMatchObject({
      executedTrays: 0,
      status: PlanEntryStatus.PLANNED,
    });
  });

  it('counts only the sowings of THIS entry', async () => {
    const tx = setup();
    tx.ssmSowings.push(
      { planEntryId: 'entry-1', numberOfTrays: 30 },
      { planEntryId: 'entry-2', numberOfTrays: 900 },
    );

    await syncPlanEntryProgress(asTx(tx), 'entry-1');

    expect(tx.updates[0].data.executedTrays).toBe(30);
  });

  it('writes executedQuantity — not executedTrays — for an LPM plan', async () => {
    const tx = setup();
    tx.entries[0].planType = 'LPM';
    tx.entries[0].plannedQuantity = 50_000;
    tx.lpmSowings.push({ planEntryId: 'entry-1', quantityUsed: 20_000 });

    await syncPlanEntryProgress(asTx(tx), 'entry-1');

    expect(tx.updates[0].data).toEqual({
      executedQuantity: 20_000,
      status: PlanEntryStatus.PARTIALLY_EXECUTED,
    });
  });

  it('leaves a CLOSED entry completely alone — closed is final', async () => {
    const tx = setup();
    tx.entries[0].status = PlanEntryStatus.CLOSED;
    tx.ssmSowings.push({ planEntryId: 'entry-1', numberOfTrays: 999 });

    await syncPlanEntryProgress(asTx(tx), 'entry-1');

    expect(tx.updates).toEqual([]);
  });

  it('does nothing at all for an entry that no longer exists', async () => {
    const tx = setup();

    await expect(
      syncPlanEntryProgress(asTx(tx), 'gone'),
    ).resolves.toBeUndefined();

    expect(tx.updates).toEqual([]);
  });

  it('will not call an entry EXECUTED when the plan says zero (SPLAN-06)', async () => {
    // `planned = 0` is what a corrupted entry looks like — an SSM entry whose
    // plannedTrays was wiped by the old typeless `updateEntry`. `executed >= 0`
    // is true for everything, so without the `planned > 0` guard every such
    // entry would silently declare itself finished.
    const tx = setup();
    tx.entries[0].plannedTrays = null;
    tx.ssmSowings.push({ planEntryId: 'entry-1', numberOfTrays: 100 });

    await syncPlanEntryProgress(asTx(tx), 'entry-1');

    expect(tx.updates[0].data.status).toBe(PlanEntryStatus.PARTIALLY_EXECUTED);
  });
});

describe('assertEntrySowable', () => {
  const openPlan = PlanStatus.IN_PROGRESS;

  it('allows a planned entry on an open plan', () => {
    expect(() =>
      assertEntrySowable({ status: PlanEntryStatus.PLANNED }, openPlan),
    ).not.toThrow();
  });

  it('allows a partly sown entry — the plan is a forecast, not a limit', () => {
    expect(() =>
      assertEntrySowable(
        { status: PlanEntryStatus.PARTIALLY_EXECUTED },
        openPlan,
      ),
    ).not.toThrow();
  });

  it('refuses an entry that is already fully sown', () => {
    expect(() =>
      assertEntrySowable({ status: PlanEntryStatus.EXECUTED }, openPlan),
    ).toThrow('This plan entry has already been fully sown.');
  });

  it('refuses a CLOSED entry, and says how to get out (SPLAN-02)', () => {
    // The whole defect: this used to be allowed, the sowing was created and the
    // stock consumed, and the sync above skipped the entry — a real sowing with
    // no bookkeeping anywhere.
    expect(() =>
      assertEntrySowable({ status: PlanEntryStatus.CLOSED }, openPlan),
    ).toThrow(
      'This plan entry was closed on purpose. Reopen it before sowing.',
    );
  });

  it('refuses any entry on a plan marked COMPLETED', () => {
    expect(() =>
      assertEntrySowable(
        { status: PlanEntryStatus.PLANNED },
        PlanStatus.COMPLETED,
      ),
    ).toThrow('This plan is marked complete. Reopen it before sowing.');
  });

  it('refuses all three with a BadRequestException, which the filter renders', () => {
    expect(() =>
      assertEntrySowable({ status: PlanEntryStatus.CLOSED }, openPlan),
    ).toThrow(BadRequestException);
  });
});

describe('isFinishedEntry', () => {
  it('counts EXECUTED and CLOSED as done', () => {
    expect(isFinishedEntry(PlanEntryStatus.EXECUTED)).toBe(true);
    expect(isFinishedEntry(PlanEntryStatus.CLOSED)).toBe(true);
  });

  it('does not count the two that still want work', () => {
    expect(isFinishedEntry(PlanEntryStatus.PLANNED)).toBe(false);
    expect(isFinishedEntry(PlanEntryStatus.PARTIALLY_EXECUTED)).toBe(false);
  });
});

describe('summarisePlanProgress', () => {
  const totals = (
    rows: (Partial<PlanEntryTotals> & { status: string; count: number })[],
  ): PlanEntryTotals[] =>
    rows.map((row) => ({
      plannedTrays: 0,
      plannedQuantity: 0,
      executedTrays: 0,
      executedQuantity: 0,
      ...row,
    }));

  it('adds up trays for an SSM plan', () => {
    const progress = summarisePlanProgress(
      'SSM',
      totals([
        {
          status: PlanEntryStatus.EXECUTED,
          count: 1,
          plannedTrays: 100,
          executedTrays: 100,
        },
        {
          status: PlanEntryStatus.PLANNED,
          count: 1,
          plannedTrays: 300,
        },
      ]),
    );

    expect(progress).toMatchObject({
      entryCount: 2,
      executedCount: 1,
      plannedTotal: 400,
      executedTotal: 100,
      progressPercent: 25,
      isComplete: false,
    });
  });

  it('adds up quantity for an LPM plan', () => {
    const progress = summarisePlanProgress(
      'LPM',
      totals([
        {
          status: PlanEntryStatus.EXECUTED,
          count: 1,
          plannedQuantity: 40_000,
          executedQuantity: 35_000,
        },
      ]),
    );

    expect(progress.plannedTotal).toBe(40_000);
    expect(progress.executedTotal).toBe(35_000);
  });

  it('counts a CLOSED entry as done, so the plan can reach 100 %', () => {
    // 145 000 of 150 000, closed on purpose. Before: the plan sat at 97 % for
    // ever. The executed total stays honest; only the percentage is completed.
    const progress = summarisePlanProgress(
      'LPM',
      totals([
        {
          status: PlanEntryStatus.CLOSED,
          count: 1,
          plannedQuantity: 150_000,
          executedQuantity: 145_000,
        },
      ]),
    );

    expect(progress).toMatchObject({
      executedCount: 1,
      closedCount: 1,
      executedTotal: 145_000,
      progressPercent: 100,
      isComplete: true,
    });
  });

  it('does not inflate the executed total with the closed entry’s shortfall', () => {
    const progress = summarisePlanProgress(
      'LPM',
      totals([
        {
          status: PlanEntryStatus.CLOSED,
          count: 1,
          plannedQuantity: 150_000,
          executedQuantity: 145_000,
        },
      ]),
    );

    expect(progress.executedTotal).toBe(145_000);
  });

  it('clamps a plan that was over-sown at 100, not 120', () => {
    // The number went straight into a CSS width on both clients.
    const progress = summarisePlanProgress(
      'SSM',
      totals([
        {
          status: PlanEntryStatus.EXECUTED,
          count: 1,
          plannedTrays: 100,
          executedTrays: 120,
        },
      ]),
    );

    expect(progress.progressPercent).toBe(100);
    expect(progress.executedTotal).toBe(120);
  });

  it('reports 0 % when nothing is planned', () => {
    const progress = summarisePlanProgress(
      'SSM',
      totals([{ status: PlanEntryStatus.PLANNED, count: 1 }]),
    );

    expect(progress.progressPercent).toBe(0);
    expect(progress.isComplete).toBe(false);
  });

  it('is complete once every entry is finished', () => {
    const progress = summarisePlanProgress(
      'SSM',
      totals([
        {
          status: PlanEntryStatus.EXECUTED,
          count: 2,
          plannedTrays: 10,
          executedTrays: 10,
        },
        {
          status: PlanEntryStatus.CLOSED,
          count: 1,
          plannedTrays: 5,
          executedTrays: 4,
        },
      ]),
    );

    expect(progress.isComplete).toBe(true);
    expect(progress.entryCount).toBe(3);
    expect(progress.executedCount).toBe(3);
  });
});
