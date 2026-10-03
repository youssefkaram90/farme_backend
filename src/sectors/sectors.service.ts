import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSectorDto } from './dto/create-sector.dto';
import { UpdateSectorDto } from './dto/update-sector.dto';
import { SeasonService } from '../season/season.service';
import { ERROR_MESSAGES } from '../common/error-messages';
import { counted, countedList } from '../common/usage-count';

@Injectable()
export class SectorsService {
  constructor(
    private prismaService: PrismaService,
    private seasonService: SeasonService,
  ) {}

  async create(createSectorDto: CreateSectorDto) {
    const existing = await this.prismaService.sector.findFirst({
      where: {
        seasonId: this.seasonService.getActiveSeasonId(),
        name: createSectorDto.name,
        location: createSectorDto.location ?? null,
      },
    });

    if (existing) {
      throw new ConflictException(
        `Sector ${createSectorDto.name} already exists in this location`,
      );
    }

    return this.prismaService.sector.create({
      data: {
        ...createSectorDto,
        seasonId: this.seasonService.getActiveSeasonId(),
      },
    });
  }

  async findAll(q?: string) {
    const seasonId = this.seasonService.getActiveSeasonId();
    const where = q
      ? {
          seasonId,
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { location: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : { seasonId };

    return this.prismaService.sector.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        // The counts the delete guard is about (SEC-02). The list used to count
        // only sowings, so a sector that was merely planned for still looked
        // free to anyone reading the screen.
        _count: {
          select: {
            lpmSowings: true,
            sowingPlanEntries: true,
            harvestRecords: true,
            cropOperationLocations: true,
            cropCarePlanLocations: true,
          },
        },
      },
    });
  }

  async findOne(id: string) {
    const sector = await this.prismaService.sector.findUnique({
      where: { id },
      include: {
        lpmSowings: {
          orderBy: { sowingDate: 'desc' },
          include: { plantStock: true },
        },
      },
    });

    if (!sector) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    return sector;
  }

  async update(id: string, updateSectorDto: UpdateSectorDto) {
    const sector = await this.findOne(id);

    // Only when a name was sent: in a partial edit the rest may be absent, and
    // an absent location would be compared as `null`, reporting a clash with a
    // sector in another location that is not a clash at all. When no location is
    // sent the comparison uses the one the sector already has.
    if (updateSectorDto.name !== undefined) {
      const clash = await this.prismaService.sector.findFirst({
        where: {
          seasonId: sector.seasonId,
          name: updateSectorDto.name,
          location: updateSectorDto.location ?? sector.location ?? null,
          id: { not: id },
        },
      });

      if (clash) {
        throw new ConflictException(
          `Sector ${updateSectorDto.name} already exists in this location`,
        );
      }
    }

    return this.prismaService.sector.update({
      where: { id },
      data: updateSectorDto,
    });
  }

  /**
   * Refuses to delete a sector that anything still points at (SEC-01), for the
   * same reason as tunnels: the cascades would take the harvest records and the
   * crop care with them, and `SowingLPM` / `SowingPlanEntry` would be silently
   * detached from the sector they were sown in.
   */
  async remove(id: string) {
    const sector = await this.findOne(id);

    const counts = await this.prismaService.sector.findUnique({
      where: { id },
      select: {
        _count: {
          select: {
            lpmSowings: true,
            sowingPlanEntries: true,
            harvestRecords: true,
            cropOperationLocations: true,
            cropCarePlanLocations: true,
          },
        },
      },
    });

    const used = countedList([
      counted(counts?._count?.lpmSowings, 'sowing', 'sowings'),
      counted(counts?._count?.sowingPlanEntries, 'plan entry', 'plan entries'),
      counted(
        counts?._count?.harvestRecords,
        'harvest record',
        'harvest records',
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

    if (used) {
      throw new ConflictException(
        `Sector ${sector.name} is still used by ${used}, so it cannot be deleted — the history would go with it.`,
      );
    }

    return this.prismaService.sector.delete({ where: { id } });
  }
}
