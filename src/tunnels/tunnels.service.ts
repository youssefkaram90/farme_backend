import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTunnelDto } from './dto/create-tunnel.dto';
import { UpdateTunnelDto } from './dto/update-tunnel.dto';
import { SeasonService } from '../season/season.service';
import { ERROR_MESSAGES } from '../common/error-messages';
import { counted, countedList } from '../common/usage-count';

@Injectable()
export class TunnelsService {
  constructor(
    private prismaService: PrismaService,
    private seasonService: SeasonService,
  ) {}

  async create(createTunnelDto: CreateTunnelDto) {
    const seasonId = this.seasonService.getActiveSeasonId();
    const existing = await this.prismaService.tunnel.findFirst({
      where: { number: createTunnelDto.number, seasonId },
    });

    if (existing) {
      throw new ConflictException(
        `Tunnel ${createTunnelDto.number} already exists in this season`,
      );
    }

    return this.prismaService.tunnel.create({
      data: {
        ...createTunnelDto,
        seasonId,
      },
    });
  }

  async findAll(q?: string) {
    const seasonId = this.seasonService.getActiveSeasonId();
    const where = q
      ? { seasonId, number: { contains: q, mode: 'insensitive' as const } }
      : { seasonId };

    const tunnels = await this.prismaService.tunnel.findMany({
      where,
      orderBy: { number: 'asc' },
      include: {
        _count: {
          select: {
            ssmSowings: true,
            sowingTunnelAssignments: true,
            harvestRecords: true,
            cropOperationLocations: true,
            cropCarePlanLocations: true,
          },
        },
      },
    });

    /**
     * `canEdit` is worked out HERE, once (TNL-1).
     *
     * A tunnel is correctable only while nothing points at it, because its number
     * is COPIED onto `SowingSSM.tunnelNumber` and into `PlantStock.location` — see
     * `update()`. The clients cannot work that out for themselves: they would have
     * to repeat this count, and the copy they can see (`_count.ssmSowings`) is only
     * one of five ways a tunnel is used. So the server answers the question.
     */
    return tunnels.map((tunnel) => ({
      ...tunnel,
      canEdit: !this.isUsed(tunnel._count),
    }));
  }

  async findOne(id: string) {
    const tunnel = await this.prismaService.tunnel.findUnique({
      where: { id },
      include: {
        ssmSowings: {
          orderBy: { sowingDate: 'desc' },
          include: { plantStock: true },
        },
      },
    });

    if (!tunnel) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    return tunnel;
  }

  async update(id: string, updateTunnelDto: UpdateTunnelDto) {
    const tunnel = await this.findOne(id);

    /**
     * Only an EMPTY tunnel can be corrected (TNL-1, decided 2026-10-07).
     *
     * The number is not just this row's field: it is copied onto
     * `SowingSSM.tunnelNumber` and written into `PlantStock.location` as a string,
     * and both copies are only refreshed when a SOWING changes — never when the
     * tunnel does. Renaming a tunnel that anything points at would therefore leave
     * them holding the old number for good, and two screens would disagree with no
     * error to explain it (the plant-stock list prefers the live relation, the tray
     * transport reads the copy).
     *
     * While the tunnel is empty there is nothing to go stale, so a mistyped number
     * can still be fixed — which it cannot be by deleting and re-creating once a
     * sowing uses it (see `remove`).
     */
    const used = await this.usedBy(id);

    if (used) {
      throw new ConflictException(
        `Tunnel ${tunnel.number} is already used by ${used}, so it can no longer be changed. A tunnel can only be corrected while nothing points at it.`,
      );
    }

    // The record's OWN season, not the active one (TUN-02). The sectors twin
    // already did this; tunnels compared a closed season's tunnel against the
    // open season's numbers, so a real clash was missed and an unrelated one
    // could be reported.
    //
    // Only worth checking when a number was actually sent: an omitted `number`
    // is `undefined`, Prisma ignores it, and the query would then find *another*
    // tunnel in the season and report a clash that does not exist.
    if (updateTunnelDto.number !== undefined) {
      const clash = await this.prismaService.tunnel.findFirst({
        where: {
          seasonId: tunnel.seasonId,
          number: updateTunnelDto.number,
          id: { not: id },
        },
      });

      if (clash) {
        throw new ConflictException(
          `Tunnel ${updateTunnelDto.number} already exists in this season`,
        );
      }
    }

    return this.prismaService.tunnel.update({
      where: { id },
      data: updateTunnelDto,
    });
  }

  /**
   * Refuses to delete a tunnel that anything still points at (TUN-01).
   *
   * The schema answers this question with cascades: deleting a tunnel deletes
   * its transport assignments, its crop care operations and — the dangerous one
   * — its harvest records, while `SowingSSM.tunnelId` is quietly set to null and
   * the stock keeps the quantities it was booked with. So rows disappear, the
   * history with them, and nothing anywhere says why a batch is missing.
   *
   * The guard counts what would be destroyed and says it in plain language,
   * because whoever deletes a tunnel is a person, not a schema.
   */
  async remove(id: string) {
    const tunnel = await this.findOne(id);
    const used = await this.usedBy(id);

    if (used) {
      throw new ConflictException(
        `Tunnel ${tunnel.number} is still used by ${used}, so it cannot be deleted — the history would go with it.`,
      );
    }

    return this.prismaService.tunnel.delete({ where: { id } });
  }

  /**
   * What still points at a tunnel, as prose — `null` when nothing does.
   *
   * One implementation for both guards: `remove` and `update` refuse for the same
   * reason and must never disagree about whether a tunnel is in use.
   */
  private async usedBy(id: string): Promise<string | null> {
    const counts = await this.prismaService.tunnel.findUnique({
      where: { id },
      select: {
        _count: {
          select: {
            ssmSowings: true,
            sowingTunnelAssignments: true,
            harvestRecords: true,
            cropOperationLocations: true,
            cropCarePlanLocations: true,
          },
        },
      },
    });

    return countedList([
      counted(counts?._count?.ssmSowings, 'sowing', 'sowings'),
      counted(
        counts?._count?.harvestRecords,
        'harvest record',
        'harvest records',
      ),
      counted(
        counts?._count?.sowingTunnelAssignments,
        'transport',
        'transports',
      ),
      counted(
        counts?._count?.cropOperationLocations,
        'crop care operation',
        'crop care operations',
      ),
      counted(
        counts?._count?.cropCarePlanLocations,
        'crop care plan',
        'crop care plans',
      ),
    ]);
  }

  /**
   * Whether any of those counts is non-zero.
   *
   * Written out rather than looping over the object: Prisma's `_count` is a named
   * type without an index signature, so `Object.values(counts)` would not type. It
   * also names, here, the five ways a tunnel is used — the same five `usedBy`
   * counts, so the two cannot drift.
   */
  private isUsed(counts: {
    ssmSowings: number;
    sowingTunnelAssignments: number;
    harvestRecords: number;
    cropOperationLocations: number;
    cropCarePlanLocations: number;
  }): boolean {
    return (
      counts.ssmSowings > 0 ||
      counts.sowingTunnelAssignments > 0 ||
      counts.harvestRecords > 0 ||
      counts.cropOperationLocations > 0 ||
      counts.cropCarePlanLocations > 0
    );
  }
}
