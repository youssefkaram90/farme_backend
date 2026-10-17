import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  CreateTunnelAssignmentsDto,
  UpdateTunnelAssignmentDto,
} from './dto/tunnel-assignment.dto';
import { SeasonService } from '../season/season.service';
import { getPaginationParams } from '../common/pagination';
import { ERROR_MESSAGES } from '../common/error-messages';
import { UNASSIGNED_LOCATION } from '../common/sowing.constants';

@Injectable()
export class TrayTransportService {
  constructor(
    private prisma: PrismaService,
    private seasonService: SeasonService,
  ) {}

  /**
   * Send the trays of a sowing to a tunnel.
   *
   * What changed here, and why (TRAY-01 / TRAY-02 / TRAY-03):
   *
   * - **One transaction.** The room check used to read, then write, with nothing
   *   holding the two together, so two requests arriving at the same moment could
   *   both see room for a batch and both take it — past the tunnel's capacity.
   * - **The season is checked.** The ids travel in the BODY (`assignments[].
   *   ssmSowingId` / `tunnelId`), not in the URL, so `SeasonWriteInterceptor`
   *   cannot judge this route: this is the only check that exists. The rule is the
   *   same one used everywhere — a normal user cannot move trays of a closed
   *   season, an administrator may still correct one.
   * - **It no longer rewrites `SowingPlan.location`.** That field is what the user
   *   typed when the plan was created, and it is part of the key that keeps a plan
   *   name unique (`@@unique([seasonId, location, name])`), so deriving it from
   *   the tunnels made stored data disagree with the input it records — and moved
   *   the key the duplicate-name check compares against. Which tunnels a plan's
   *   batches went to is per-sowing data and is already on the sowing and on these
   *   assignments.
   */
  async assign(dto: CreateTunnelAssignmentsDto) {
    const { assignments, transportDate } = dto;
    const date = transportDate ? new Date(transportDate) : new Date();

    // Only a date the caller actually sent is judged — the fallback is "now",
    // which is inside the open season by definition (SEASON-08).
    if (transportDate) {
      await this.seasonService.assertDateInSeason(date, 'transport date');
    }

    return this.prisma.$transaction(async (tx) => {
      const results: Awaited<
        ReturnType<typeof tx.sowingTunnelAssignment.create>
      >[] = [];

      for (const a of assignments) {
        const sowing = await tx.sowingSSM.findUnique({
          where: { id: a.ssmSowingId },
          include: { tunnelAssignments: true, plantStock: true },
        });

        if (!sowing) {
          throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
        }

        await this.seasonService.assertWritable(sowing.seasonId);

        const tunnel = await tx.tunnel.findUnique({
          where: { id: a.tunnelId },
        });

        if (!tunnel) {
          throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
        }

        // A tunnel belongs to one season, and so does a sowing: trays of one
        // season's batch must not fill another season's tunnel — the two would
        // then be sharing a capacity that is only counted once.
        if (tunnel.seasonId !== sowing.seasonId) {
          throw new BadRequestException(
            `Tunnel ${tunnel.number} belongs to another season. Trays can only be sent to a tunnel of the same season as the sowing.`,
          );
        }

        const alreadyAssigned = sowing.tunnelAssignments.reduce(
          (sum, ta) => sum + ta.numberOfTrays,
          0,
        );
        const remaining = sowing.numberOfTrays - alreadyAssigned;

        if (a.numberOfTrays > remaining) {
          throw new BadRequestException(
            `Only ${remaining} trays are left to transport for this sowing.`,
          );
        }

        const existingAssignments = await tx.sowingTunnelAssignment.findMany({
          where: { tunnelId: a.tunnelId },
        });
        const tunnelUsed = existingAssignments.reduce(
          (sum, ta) => sum + ta.numberOfTrays,
          0,
        );
        const tunnelAvailable = tunnel.capacity - tunnelUsed;

        if (a.numberOfTrays > tunnelAvailable) {
          throw new BadRequestException(
            `Tunnel ${tunnel.number} only has room for ${tunnelAvailable} more trays.`,
          );
        }

        const existing = sowing.tunnelAssignments.find(
          (ta) => ta.tunnelId === a.tunnelId,
        );

        let result: Awaited<
          ReturnType<typeof tx.sowingTunnelAssignment.create>
        >;
        if (existing) {
          result = await tx.sowingTunnelAssignment.update({
            where: { id: existing.id },
            data: { numberOfTrays: existing.numberOfTrays + a.numberOfTrays },
            include: {
              tunnel: true,
              ssmSowing: {
                select: { variety: true, code: true, numberOfTrays: true },
              },
            },
          });
        } else {
          result = await tx.sowingTunnelAssignment.create({
            data: {
              ssmSowingId: a.ssmSowingId,
              tunnelId: a.tunnelId,
              numberOfTrays: a.numberOfTrays,
              transportDate: date,
            },
            include: {
              tunnel: true,
              ssmSowing: {
                select: { variety: true, code: true, numberOfTrays: true },
              },
            },
          });
        }

        // Propagate tunnel to SowingSSM (first assignment wins)
        if (!sowing.tunnelId) {
          await tx.sowingSSM.update({
            where: { id: a.ssmSowingId },
            data: {
              tunnelId: a.tunnelId,
              tunnelNumber: tunnel.number,
            },
          });

          // Update PlantStock location if it still has the default
          if (sowing.plantStock?.location === UNASSIGNED_LOCATION) {
            await tx.plantStock.update({
              where: { id: sowing.plantStock.id },
              data: { location: tunnel.number },
            });
          }
        }

        results.push(result);
      }

      return results;
    });
  }

  async findBySowing(ssmSowingId: string) {
    const sowing = await this.prisma.sowingSSM.findUnique({
      where: { id: ssmSowingId },
      include: {
        tunnelAssignments: {
          include: { tunnel: true },
          orderBy: { transportDate: 'desc' },
        },
      },
    });

    if (!sowing) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    return sowing.tunnelAssignments;
  }

  async findByTunnel(tunnelId: string) {
    const tunnel = await this.prisma.tunnel.findUnique({
      where: { id: tunnelId },
      include: {
        sowingTunnelAssignments: {
          include: {
            ssmSowing: {
              select: {
                id: true,
                variety: true,
                lotNumber: true,
                numberOfTrays: true,
              },
            },
          },
          orderBy: { transportDate: 'desc' },
        },
      },
    });

    if (!tunnel) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    return {
      tunnel: {
        id: tunnel.id,
        number: tunnel.number,
        capacity: tunnel.capacity,
      },
      assignments: tunnel.sowingTunnelAssignments,
      totalAssigned: tunnel.sowingTunnelAssignments.reduce(
        (sum, a) => sum + a.numberOfTrays,
        0,
      ),
    };
  }

  /**
   * Returns SSM sowings that still have trays remaining to transport,
   * grouped by plan, with tunnel assignment info.
   */
  async findPendingTransport() {
    const sowings = await this.prisma.sowingSSM.findMany({
      where: {
        seasonId: this.seasonService.getActiveSeasonId(),
        plan: { planType: 'SSM' },
      },
      orderBy: { sowingDate: 'desc' },
      include: {
        plan: { select: { id: true, name: true } },
        tunnelAssignments: {
          include: { tunnel: { select: { id: true, number: true } } },
        },
      },
    });

    // Calculate remaining trays and filter those with remaining > 0
    const pending = sowings
      .map((s) => {
        const assigned = s.tunnelAssignments.reduce(
          (sum, ta) => sum + ta.numberOfTrays,
          0,
        );
        return {
          id: s.id,
          planId: s.plan.id,
          planName: s.plan.name,
          variety: s.variety,
          code: s.code,
          lotNumber: s.lotNumber,
          stockType: s.stockType,
          numberOfTrays: s.numberOfTrays,
          assignedTrays: assigned,
          remainingTrays: s.numberOfTrays - assigned,
          tunnelNumber: s.tunnelNumber,
          sowingDate: s.sowingDate,
          assignments: s.tunnelAssignments.map((ta) => ({
            id: ta.id,
            tunnelId: ta.tunnel.id,
            tunnelNumber: ta.tunnel.number,
            numberOfTrays: ta.numberOfTrays,
            transportDate: ta.transportDate,
          })),
        };
      })
      .filter((s) => s.remainingTrays > 0);

    // Group by plan
    const grouped: Record<
      string,
      { planId: string; planName: string; sowings: typeof pending }
    > = {};

    for (const s of pending) {
      if (!grouped[s.planId]) {
        grouped[s.planId] = {
          planId: s.planId,
          planName: s.planName,
          sowings: [],
        };
      }
      grouped[s.planId].sowings.push(s);
    }

    return Object.values(grouped);
  }

  async findAll(page?: string, pageSize?: string) {
    // Season-scoped (TRAY-06): this used to return every assignment ever made,
    // every season's included, on a screen that is about the season being worked
    // in. Opt-in paging as everywhere else — no parameters gives the same array
    // as before.
    const where = {
      ssmSowing: { seasonId: this.seasonService.getActiveSeasonId() },
    };

    const include = {
      tunnel: { select: { id: true, number: true, capacity: true } },
      ssmSowing: {
        select: {
          id: true,
          variety: true,
          numberOfTrays: true,
          lotNumber: true,
          plan: { select: { name: true } },
        },
      },
    };

    const pagination = getPaginationParams(page, pageSize);

    if (!pagination) {
      return this.prisma.sowingTunnelAssignment.findMany({
        where,
        include,
        orderBy: { transportDate: 'desc' },
      });
    }

    const [total, items] = await Promise.all([
      this.prisma.sowingTunnelAssignment.count({ where }),
      this.prisma.sowingTunnelAssignment.findMany({
        where,
        include,
        orderBy: { transportDate: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);

    return {
      items,
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
      hasMore: pagination.page * pagination.pageSize < total,
    };
  }

  /**
   * Correct how many trays of a batch sit in a tunnel.
   *
   * The batch's own remaining count was checked here, but the tunnel's capacity
   * was not — so this was the one route that could put more trays into a tunnel
   * than it holds (TRAY-04). Both checks run inside one transaction now, and both
   * use the same arithmetic `assign` does.
   *
   * The TUNNEL cannot change here (the DTO carries `numberOfTrays` only), so the
   * plant-stock location needs no recalculation — trays move between tunnels by
   * removing one transport and creating another (TRAY-06).
   */
  async update(id: string, dto: UpdateTunnelAssignmentDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.sowingTunnelAssignment.findUnique({
        where: { id },
        include: { ssmSowing: true, tunnel: true },
      });

      if (!existing) {
        throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
      }

      const sowing = await tx.sowingSSM.findUnique({
        where: { id: existing.ssmSowingId },
        include: { tunnelAssignments: true },
      });

      if (!sowing) {
        throw new NotFoundException('This sowing no longer exists.');
      }

      const otherAssigned = sowing.tunnelAssignments
        .filter((ta) => ta.id !== id)
        .reduce((sum, ta) => sum + ta.numberOfTrays, 0);
      const remaining = sowing.numberOfTrays - otherAssigned;

      if (dto.numberOfTrays > remaining) {
        throw new BadRequestException(
          `Only ${remaining} trays are left to transport for this sowing.`,
        );
      }

      const othersInTunnel = await tx.sowingTunnelAssignment.findMany({
        where: { tunnelId: existing.tunnelId, id: { not: id } },
      });
      const tunnelUsed = othersInTunnel.reduce(
        (sum, ta) => sum + ta.numberOfTrays,
        0,
      );
      const tunnelAvailable = existing.tunnel.capacity - tunnelUsed;

      if (dto.numberOfTrays > tunnelAvailable) {
        throw new BadRequestException(
          `Tunnel ${existing.tunnel.number} holds ${existing.tunnel.capacity} trays and ${tunnelUsed} are already in it — ${tunnelAvailable} are free.`,
        );
      }

      return tx.sowingTunnelAssignment.update({
        where: { id },
        data: { numberOfTrays: dto.numberOfTrays },
        include: {
          tunnel: true,
          ssmSowing: { select: { variety: true, numberOfTrays: true } },
        },
      });
    });
  }

  async remove(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.sowingTunnelAssignment.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
      }

      // No plan-location recalculation any more: the plan's location is the one
      // the user typed, and removing an assignment was never supposed to rewrite
      // it (TRAY-01). The PLANT STOCK's location is a different field, and that
      // one does have to follow the trays (TRAY-06).
      await tx.sowingTunnelAssignment.delete({ where: { id } });

      await this.resyncTunnelPointers(
        tx,
        existing.ssmSowingId,
        existing.tunnelId,
      );

      return { message: 'Assignment removed' };
    });
  }

  /**
   * Put a batch's tunnel back in step with its transports (TRAY-06 / TRAY-07).
   *
   * TWO fields claim to know where a batch is, and neither was corrected when trays
   * LEFT a tunnel:
   *
   * - `PlantStock.location` — the copy the plant-stock list falls back to for a batch
   *   with no transport rows ("not transported yet → planned location"). Left alone,
   *   the variety stayed filed under a tunnel it had left (TRAY-06).
   * - `SowingSSM.tunnelId` / `tunnelNumber` — set by `assign` ("first assignment
   *   wins"). Left alone, this is why an emptied tunnel could NEVER be corrected: the
   *   edit rule counts the sowings pointing at a tunnel, so one sowing left behind
   *   kept the tunnel permanently "in use" (TRAY-07).
   *
   * The rule for both: the MOST RECENT surviving transport wins — that is where the
   * batch is now — and nothing surviving means it is not in a tunnel at all.
   *
   * `emptiedTunnelId` is the tunnel the removed transport was in. The SOWING's own
   * tunnel is touched ONLY when it points at that tunnel: a tunnel the operator chose
   * on the sowing form, or one the trays left earlier, must not be clobbered by an
   * unrelated removal. The plant stock's copy is always recomputed, because it is a
   * description of where the batch is rather than a decision.
   */
  private async resyncTunnelPointers(
    tx: Prisma.TransactionClient,
    ssmSowingId: string,
    emptiedTunnelId: string,
  ): Promise<void> {
    const latest = await tx.sowingTunnelAssignment.findFirst({
      where: { ssmSowingId },
      orderBy: { transportDate: 'desc' },
      include: { tunnel: true },
    });

    await tx.plantStock.updateMany({
      where: { ssmSowingId },
      data: { location: latest?.tunnel?.number ?? UNASSIGNED_LOCATION },
    });

    const sowing = await tx.sowingSSM.findUnique({
      where: { id: ssmSowingId },
    });

    if (sowing?.tunnelId === emptiedTunnelId) {
      await tx.sowingSSM.update({
        where: { id: ssmSowingId },
        data: {
          tunnelId: latest?.tunnelId ?? null,
          tunnelNumber: latest?.tunnel?.number ?? null,
        },
      });
    }
  }
}
