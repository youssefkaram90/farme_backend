import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTruckDto, UpdateTruckDto } from './dto/truck.dto';
import { SeasonService } from '../season/season.service';
import { ERROR_MESSAGES } from '../common/error-messages';

@Injectable()
export class TrucksService {
  constructor(
    private prismaService: PrismaService,
    private seasonService: SeasonService,
  ) {}

  /**
   * Every truck, with how many shipments it carries — the list needs the count,
   * and the delete below needs it to explain a refusal.
   */
  async findAll() {
    return this.prismaService.truck.findMany({
      where: { seasonId: this.seasonService.getActiveSeasonId() },
      orderBy: { name: 'asc' },
      include: { _count: { select: { shipments: true } } },
    });
  }

  /**
   * One truck with everything it carries — the truck detail screen. Shipments
   * come newest first, each with its lines and the finished-goods product behind
   * them, so the screen needs no second request.
   */
  async findOne(id: string) {
    const truck = await this.prismaService.truck.findUnique({
      where: { id },
      include: {
        shipments: {
          orderBy: { shipmentDate: 'desc' },
          include: {
            lines: { include: { harvestedProduct: true } },
          },
        },
      },
    });

    if (!truck) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    // Reads are season-scoped (TRUCK-01). `findAll` always filtered, this did
    // not — so `GET /trucks/:id` answered with another season's truck, complete
    // with its shipments and their lines.
    this.seasonService.assertReadable(truck.seasonId);

    return truck;
  }

  async create(dto: CreateTruckDto) {
    const seasonId = this.seasonService.getActiveSeasonId();

    // The plates arrive normalized (see `NormalizePlate`), so this comparison is
    // exact and two spellings of one trailer cannot both get in (TRUCK-02).
    await this.assertTrailerPlateFree(dto.trailerPlateNumber, seasonId);

    return this.prismaService.truck.create({
      data: {
        seasonId,
        name: dto.name,
        trailerPlateNumber: dto.trailerPlateNumber,
        truckPlateNumber: dto.truckPlateNumber || null,
      },
    });
  }

  /**
   * A trailer plate may only be on one truck (TRUCK-02).
   *
   * Two trucks with the same trailer is always the same trailer entered twice —
   * and then a shipment looks like it went out on a truck it never saw. The
   * comparison is exact because the DTO already normalized the plate, and it is
   * scoped to the season because trucks are.
   *
   * This is a check rather than a database constraint on purpose: an `@@unique`
   * would be a migration, and it would fail on whatever duplicates already exist
   * in the data. A constraint is the better long-term home for this, once the
   * existing rows have been cleaned up.
   */
  private async assertTrailerPlateFree(
    plate: string,
    seasonId: string,
    exceptId?: string,
  ) {
    if (!plate) return;

    const clash = await this.prismaService.truck.findFirst({
      where: {
        seasonId,
        trailerPlateNumber: plate,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { name: true },
    });

    if (clash) {
      throw new ConflictException(
        `Trailer ${plate} is already on ${clash.name}.`,
      );
    }
  }

  /**
   * Used mainly to fill in the plates on trucks that were backfilled from the
   * old free-text field — they start with an empty trailer plate.
   */
  async update(id: string, dto: UpdateTruckDto) {
    const truck = await this.prismaService.truck.findUnique({
      where: { id },
    });
    if (!truck) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    this.seasonService.assertReadable(truck.seasonId);

    // Only when the plate is actually being changed, and never against this
    // truck itself (TRUCK-02).
    if (dto.trailerPlateNumber !== undefined) {
      await this.assertTrailerPlateFree(
        dto.trailerPlateNumber,
        truck.seasonId,
        id,
      );
    }

    return this.prismaService.truck.update({
      where: { id },
      data: {
        name: dto.name,
        trailerPlateNumber: dto.trailerPlateNumber,
        // undefined = leave alone; "" = explicitly clear the optional plate.
        truckPlateNumber:
          dto.truckPlateNumber === undefined
            ? undefined
            : dto.truckPlateNumber || null,
      },
    });
  }

  /**
   * Deleting a truck that still carries shipments is refused. The relation is
   * already ON DELETE RESTRICT, but checking here gives a readable message
   * instead of a raw foreign-key error.
   */
  async remove(id: string) {
    const truck = await this.prismaService.truck.findUnique({
      where: { id },
      include: { _count: { select: { shipments: true } } },
    });

    if (!truck) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    this.seasonService.assertReadable(truck.seasonId);

    const count = truck._count.shipments;
    if (count > 0) {
      throw new BadRequestException(
        `${truck.name} still has ${count} shipment${
          count === 1 ? '' : 's'
        }. Move or delete ${count === 1 ? 'it' : 'them'} first.`,
      );
    }

    await this.prismaService.truck.delete({ where: { id } });

    return { id };
  }
}
