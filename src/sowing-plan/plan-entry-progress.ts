import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PlanEntryStatus, PlanStatus } from './enums/plan-type.enum';

type TxClient = Prisma.TransactionClient;

/**
 * The statuses an entry sits in once nobody has to touch it again.
 *
 * One definition, shared by the three places that ask the question: whether a
 * plan may be declared COMPLETED, whether it counts as done in the plan's
 * progress, and whether it may still be executed. CLOSED belongs here by design —
 * an entry is closed by hand when less than planned was sown (e.g. 145 000 of
 * 150 000), and treating that as unfinished is what kept such a plan below 100 %
 * for ever (SPLAN-08).
 *
 * `string[]` rather than `PlanEntryStatus[]` because the column is a plain
 * `String` in the schema, so that is what Prisma hands back.
 */
export const FINISHED_ENTRY_STATUSES: string[] = [
  PlanEntryStatus.EXECUTED,
  PlanEntryStatus.CLOSED,
];

/** Is this entry done with, whichever way it got there? */
export const isFinishedEntry = (status: string): boolean =>
  FINISHED_ENTRY_STATUSES.includes(status);

/**
 * May more be sown against this entry?
 *
 * Both sowing paths used to refuse only EXECUTED, which let a **CLOSED** entry
 * be sown: the sowing was created and the stock consumed, while
 * `syncPlanEntryProgress` skipped the entry (closed is final) so the trays and
 * the counters never moved — a real sowing with no bookkeeping, and no screen
 * that could show it, because a closed entry is also absent from every pending
 * list (SPLAN-02).
 *
 * A plan that has been declared COMPLETED is refused for the same reason: the
 * status is what every screen reports as "this plan is done".
 *
 * Shared rather than duplicated so the two paths cannot drift apart again.
 */
export function assertEntrySowable(
  entry: { status: string },
  planStatus: string,
): void {
  if (entry.status === PlanEntryStatus.EXECUTED) {
    throw new BadRequestException(
      'This plan entry has already been fully sown.',
    );
  }

  if (entry.status === PlanEntryStatus.CLOSED) {
    throw new BadRequestException(
      'This plan entry was closed on purpose. Reopen it before sowing.',
    );
  }

  if (planStatus === PlanStatus.COMPLETED) {
    throw new BadRequestException(
      'This plan is marked complete. Reopen it before sowing.',
    );
  }
}

/** One `groupBy` row: how much of one status one plan holds. */
export type PlanEntryTotals = {
  status: string;
  count: number;
  plannedTrays: number;
  plannedQuantity: number;
  executedTrays: number;
  executedQuantity: number;
};

export type PlanProgress = {
  /** every entry of the plan, whichever state it is in */
  entryCount: number;
  /** entries nobody has to touch again — executed or closed */
  executedCount: number;
  /** of those, the ones closed by hand short of the plan */
  closedCount: number;
  plannedTotal: number;
  /** the honest sum of what was actually sown */
  executedTotal: number;
  /** 0–100, clamped. See the note about closed entries. */
  progressPercent: number;
  /** every entry finished — the condition for completing a plan */
  isComplete: boolean;
};

/**
 * The plan-level figures the plans list shows.
 *
 * This was a **second implementation** of the same rule, written inline in
 * `findAllPlans`, and it disagreed with the entry-level one in exactly two ways
 * (SPLAN-08): it did not know about CLOSED, so a plan whose last entry was closed
 * on purpose stayed below 100 % for ever; and it did not clamp over-execution, so
 * `progressPercent` could exceed 100 — straight into a CSS width on both clients.
 *
 * An entry closed by hand counts as **done**: that is what closing it means. Its
 * shortfall is added only to the percentage, so `executedTotal` stays the honest
 * sum of what was sown, and `closedCount` lets a screen explain the difference.
 */
export function summarisePlanProgress(
  planType: string,
  totals: PlanEntryTotals[],
): PlanProgress {
  const isSSM = planType === 'SSM';

  const planned = (total: PlanEntryTotals) =>
    isSSM ? total.plannedTrays : total.plannedQuantity;
  const executed = (total: PlanEntryTotals) =>
    isSSM ? total.executedTrays : total.executedQuantity;

  let entryCount = 0;
  let finishedCount = 0;
  let closedCount = 0;
  let plannedTotal = 0;
  let executedTotal = 0;
  let closedPlanned = 0;
  let closedExecuted = 0;

  for (const total of totals) {
    entryCount += total.count;
    plannedTotal += planned(total);
    executedTotal += executed(total);

    if (total.status === PlanEntryStatus.CLOSED) {
      closedCount += total.count;
      closedPlanned += planned(total);
      closedExecuted += executed(total);
    }

    if (isFinishedEntry(total.status)) finishedCount += total.count;
  }

  const achieved = executedTotal + Math.max(0, closedPlanned - closedExecuted);

  const progressPercent =
    plannedTotal > 0
      ? Math.min(100, Math.max(0, Math.round((achieved / plannedTotal) * 100)))
      : 0;

  return {
    entryCount,
    executedCount: finishedCount,
    closedCount,
    plannedTotal,
    executedTotal,
    progressPercent,
    isComplete: finishedCount === entryCount,
  };
}

/**
 * Recompute a plan entry's executed counter + status from its linked sowings.
 * Must be called inside the same transaction as the sowing mutation so the
 * aggregate sees the in-flight write.
 */

export async function syncPlanEntryProgress(
  tx: TxClient,
  entryId: string,
): Promise<void> {
  const entry = await tx.sowingPlanEntry.findUnique({
    where: { id: entryId },
    include: { plan: { select: { planType: true } } },
  });

  if (!entry) return;

  // Manually closed entries are final: a later sowing execute / edit / delete
  // must not flip them back to PARTIALLY_EXECUTED.
  if (entry.status === PlanEntryStatus.CLOSED) return;

  const isSSM = entry.plan.planType === 'SSM';

  const executed = isSSM
    ? ((
        await tx.sowingSSM.aggregate({
          where: { planEntryId: entryId },
          _sum: { numberOfTrays: true },
        })
      )._sum.numberOfTrays ?? 0)
    : ((
        await tx.sowingLPM.aggregate({
          where: { planEntryId: entryId },
          _sum: { quantityUsed: true },
        })
      )._sum.quantityUsed ?? 0);

  const planned = isSSM
    ? (entry.plannedTrays ?? 0)
    : (entry.plannedQuantity ?? 0);

  const status: PlanEntryStatus =
    planned > 0 && executed >= planned
      ? PlanEntryStatus.EXECUTED
      : executed > 0
        ? PlanEntryStatus.PARTIALLY_EXECUTED
        : PlanEntryStatus.PLANNED;

  await tx.sowingPlanEntry.update({
    where: { id: entryId },
    data: isSSM
      ? { executedTrays: executed, status }
      : { executedQuantity: executed, status },
  });
}
