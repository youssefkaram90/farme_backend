import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../common/actor';
import { getPaginationParams } from '../common/pagination';
import { derivePlanteCode } from '../common/harvest-naming';
import { CreateHarvestRecordDto } from './dto/harvest.dto';
import { WriteOffHarvestDto } from './dto/writeoff-harvest.dto';
import { SeasonService } from '../season/season.service';
import { HarvestReferenceType } from '../common/enums/ledger-reference-type.enum';
import { ERROR_MESSAGES } from '../common/error-messages';
import { Prisma } from '../generated/prisma/client';

/** Either client — the same alias the other services use. */
type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class HarvestService {
  constructor(
    private prismaService: PrismaService,
    private seasonService: SeasonService,
  ) {}

  /**
   * Log a harvest → adds to finished-goods stock (HarvestedProduct) and
   * records a movement. totalPlants = boxCount × plantsPerBox.
   */
  async createRecord(dto: CreateHarvestRecordDto, actor: Actor) {
    // Validate location target
    if (dto.targetType === 'TUNNEL' && !dto.tunnelId) {
      throw new BadRequestException('A tunnel is required for TUNNEL harvests');
    }
    if (dto.targetType === 'SECTOR' && !dto.sectorId) {
      throw new BadRequestException('A sector is required for SECTOR harvests');
    }

    const seasonId = this.seasonService.getActiveSeasonId();

    // The batch must be a real one that is actually in the chosen location,
    // otherwise the harvested-vs-remaining figures would be credited to the
    // wrong variety.
    const batch = await this.prismaService.plantStock.findUnique({
      where: { id: dto.plantStockId },
      include: {
        ssmSowing: {
          include: { tunnelAssignments: { include: { tunnel: true } } },
        },
        lpmSowing: { select: { seasonId: true } },
      },
    });

    if (!batch) {
      throw new BadRequestException(
        'That batch no longer exists. Please pick another one.',
      );
    }

    // A batch has no season of its own — its sowing does — and a harvest is
    // always recorded in the open season (HARV-03). Without this, a batch from a
    // closed season could be harvested into the open season's finished goods.
    const batchSeasonId =
      batch.ssmSowing?.seasonId ?? batch.lpmSowing?.seasonId ?? null;

    if (batchSeasonId !== seasonId) {
      throw new BadRequestException(
        'That batch belongs to a season that is already closed.',
      );
    }

    const label = `${batch.variety} (lot ${batch.lotNumber})`;

    if (dto.targetType === 'TUNNEL') {
      const tunnel = await this.prismaService.tunnel.findUnique({
        where: { id: dto.tunnelId },
        select: { number: true, seasonId: true },
      });

      // The place has to belong to the open season as well (HARV-03): the
      // location used to be taken on trust, so a harvest could be filed against
      // another season's tunnel — or a sector that does not exist at all.
      if (!tunnel || tunnel.seasonId !== seasonId) {
        throw new BadRequestException(
          'That tunnel is not part of the open season. Pick the tunnel again.',
        );
      }

      const assignments = batch.ssmSowing?.tunnelAssignments ?? [];
      // Before tray-transport the batch still sits in its planned location.
      const inTunnel =
        assignments.length > 0
          ? assignments.some((a) => a.tunnelId === dto.tunnelId)
          : batch.location === tunnel.number;

      if (!inTunnel) {
        throw new BadRequestException(
          `Batch ${label} is not in the selected tunnel.`,
        );
      }
    } else {
      const sector = await this.prismaService.sector.findUnique({
        where: { id: dto.sectorId },
        select: { seasonId: true },
      });

      if (!sector || sector.seasonId !== seasonId) {
        throw new BadRequestException(
          'That sector is not part of the open season. Pick the sector again.',
        );
      }

      if (batch.ssmSowingId) {
        throw new BadRequestException(
          `Batch ${label} was sown in tunnels, not in a sector.`,
        );
      }
    }

    const totalPlants = dto.boxCount * dto.plantsPerBox;

    // The plant code from the box label — the finished-goods store's only way to
    // separate two batches of the same variety.
    const planteCode = derivePlanteCode(
      batch,
      dto.plantsPerBox,
      dto.targetType,
    );

    // The harvest date must belong to the season this record is filed into
    // (SEASON-08).
    await this.seasonService.assertDateInSeason(
      new Date(dto.harvestedAt),
      'harvest date',
      seasonId,
    );

    const saved = await this.prismaService.$transaction(async (tx) => {
      const record = await tx.harvestRecord.create({
        data: {
          seasonId: this.seasonService.getActiveSeasonId(),
          productName: dto.productName,
          planteCode,
          targetType: dto.targetType,
          tunnelId: dto.targetType === 'TUNNEL' ? dto.tunnelId : null,
          sectorId: dto.targetType === 'SECTOR' ? dto.sectorId : null,
          stockType: dto.targetType === 'TUNNEL' ? dto.stockType : null,
          boxCount: dto.boxCount,
          plantsPerBox: dto.plantsPerBox,
          totalPlants,
          harvestedAt: new Date(dto.harvestedAt),
          plantStockId: dto.plantStockId,
          createdBy: actor.id,
        },
        include: { tunnel: true, sector: true },
      });

      // Finished-goods stock: keyed by name, plant code AND box size so that
      // "Krypton 12" and "Krypton 13" stay separate rows, and so a 410 pack
      // never shares a pool with a 430 pack of the same batch.
      const product = await tx.harvestedProduct.upsert({
        where: {
          seasonId_name_planteCode_plantsPerBox: {
            seasonId: this.seasonService.getActiveSeasonId(),
            name: dto.productName,
            planteCode,
            plantsPerBox: dto.plantsPerBox,
          },
        },
        update: { currentQuantity: { increment: totalPlants } },
        create: {
          seasonId: this.seasonService.getActiveSeasonId(),
          name: dto.productName,
          planteCode,
          plantsPerBox: dto.plantsPerBox,
          unit: 'PLANT',
          currentQuantity: totalPlants,
        },
      });

      await tx.harvestStockMovement.create({
        data: {
          harvestedProductId: product.id,
          quantity: totalPlants,
          referenceType: HarvestReferenceType.HARVEST,
          referenceId: record.id,
          createdByName: actor.name,
        },
      });

      // Keep the batch's stage in step with what is actually left of it —
      // inside this transaction (HARV-02). Out of it, a failure here left the
      // harvest saved and the batch's stage stale, which is exactly the pair a
      // person cannot reconcile afterwards.
      await this.syncBatchStage(
        {
          plantStockId: dto.plantStockId,
          tunnelId: dto.targetType === 'TUNNEL' ? (dto.tunnelId ?? null) : null,
          sectorId: dto.targetType === 'SECTOR' ? (dto.sectorId ?? null) : null,
        },
        tx,
      );

      return record;
    });

    return saved;
  }

  async findAllRecords(
    q?: string,
    page?: string,
    pageSize?: string,
    targetType?: string,
    targetId?: string,
  ) {
    const where: Record<string, unknown> = {
      seasonId: this.seasonService.getActiveSeasonId(),
    };

    if (q) {
      where.OR = [
        { productName: { contains: q, mode: 'insensitive' as const } },
      ];
    }
    // Only the two the model knows (HARV-05): anything else used to be passed
    // straight through as a filter that could never match.
    const target =
      targetType === 'TUNNEL' || targetType === 'SECTOR'
        ? targetType
        : undefined;

    if (target) where.targetType = target;
    if (target && targetId) {
      where.tunnelId = target === 'TUNNEL' ? targetId : undefined;
      where.sectorId = target === 'SECTOR' ? targetId : undefined;
    }

    const include = { tunnel: true, sector: true };

    const pagination = getPaginationParams(page, pageSize);
    if (pagination) {
      const [total, items] = await Promise.all([
        this.prismaService.harvestRecord.count({ where }),
        this.prismaService.harvestRecord.findMany({
          where,
          include,
          orderBy: { harvestedAt: 'desc' },
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

    return this.prismaService.harvestRecord.findMany({
      where,
      include,
      orderBy: { harvestedAt: 'desc' },
    });
  }

  async findOneRecord(id: string) {
    const record = await this.prismaService.harvestRecord.findUnique({
      where: { id },
      include: { tunnel: true, sector: true },
    });
    if (!record) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    // Reads are season-scoped too (HARV-05): a record from a season the caller
    // cannot see is a 404, not a 200 carrying another season's figures.
    // `deleteRecord` and both screens come through here.
    this.seasonService.assertReadable(record.seasonId);

    return record;
  }

  async deleteRecord(id: string, actor: Actor) {
    const record = await this.findOneRecord(id);

    const result = await this.prismaService.$transaction(async (tx) => {
      // Reverse the stock: decrement the finished-goods product
      const product = await tx.harvestedProduct.findUnique({
        where: {
          seasonId_name_planteCode_plantsPerBox: {
            seasonId: record.seasonId,
            name: record.productName,
            planteCode: record.planteCode,
            plantsPerBox: record.plantsPerBox,
          },
        },
      });

      if (product) {
        const afterReversal = product.currentQuantity - record.totalPlants;

        // Refuse rather than clamp. Clamping to zero used to hide the problem:
        // the goods had already shipped, so the stock figure silently became
        // wrong instead of telling anyone.
        if (afterReversal < 0) {
          throw new BadRequestException(
            `Only ${product.currentQuantity.toLocaleString('en-GB')} ${product.name} are left in stock, but removing this harvest would take out ${record.totalPlants.toLocaleString('en-GB')}. Delete or reduce the shipments that used them first.`,
          );
        }

        await tx.harvestedProduct.update({
          where: { id: product.id },
          data: { currentQuantity: afterReversal },
        });

        // Append-only, the same rule a deleted treatment follows:
        // the `harvest` line that created these plants STAYS, and the removal is
        // recorded as a reversing line beside it. Deleting the original would
        // erase the fact that the harvest ever happened — the one thing a ledger
        // exists to keep.
        await tx.harvestStockMovement.create({
          data: {
            harvestedProductId: product.id,
            quantity: -record.totalPlants,
            referenceType: HarvestReferenceType.HARVEST,
            referenceId: id,
            reason: 'correction',
            note: 'Harvest deleted — these plants were taken back out of stock.',
            createdByName: actor.name,
          },
        });
      }

      await tx.harvestRecord.delete({ where: { id } });

      // Inside the same transaction as the delete (HARV-02): a failure here has
      // to take the delete back with it, or the batch keeps the stage the
      // deleted harvest left behind.
      if (record.plantStockId) {
        await this.syncBatchStage(
          {
            plantStockId: record.plantStockId,
            tunnelId: record.tunnelId,
            sectorId: record.sectorId,
          },
          tx,
        );
      }

      return { id };
    });

    return result;
  }

  /**
   * Write off what is left of a product: the boxes that spoiled, were thrown
   * away, or were simply counted wrong.
   *
   * This is the honest way to empty a shelf. Without it the only ways out were
   * to leave the figure wrong for ever or to delete a real harvest record — and
   * deleting the record throws the field history away with it. A write-off
   * keeps the harvest and explains where the boxes went.
   *
   * The whole remaining quantity goes at once: nobody can tell 40 spoiled boxes
   * from 55, and a part write-off would only move the wrong number around.
   */
  async writeOffProduct(
    productId: string,
    dto: WriteOffHarvestDto,
    actor: Actor,
  ) {
    const product = await this.prismaService.harvestedProduct.findUnique({
      where: { id: productId },
    });
    if (!product) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    // Only the season that is open now may be written off. A closed season is a
    // finished year: its figures have been reported, so lowering them quietly
    // afterwards would change numbers somebody already has on paper.
    if (product.seasonId !== this.seasonService.getActiveSeasonId()) {
      throw new BadRequestException(
        'That product belongs to a season that is already closed.',
      );
    }

    if (product.currentQuantity <= 0) {
      throw new BadRequestException(
        `There is nothing left of ${product.name} to write off.`,
      );
    }

    const writtenOff = product.currentQuantity;

    return this.prismaService.$transaction(async (tx) => {
      await tx.harvestedProduct.update({
        where: { id: product.id },
        data: { currentQuantity: 0 },
      });

      // Negative quantity = stock going out. This movement is what makes the
      // drop visible on the product page, next to the harvests that put the
      // boxes there in the first place.
      await tx.harvestStockMovement.create({
        data: {
          harvestedProductId: product.id,
          quantity: -writtenOff,
          referenceType: HarvestReferenceType.WRITEOFF,
          reason: dto.reason,
          note: dto.note ?? null,
          createdByName: actor.name,
        },
      });

      return { id: product.id, writtenOff, remaining: 0 };
    });
  }

  /**
   * Mark a batch HARVESTED once nothing of it is left, and put it back to READY
   * if a harvest is removed again.
   *
   * "Remaining" is derived from the harvest records and never stored, so it is
   * recomputed here. For a tunnel the expected figure is that tunnel's share of
   * the batch — a batch split over two tunnels can be finished in just one.
   *
   * The stage is only touched when it actually changes, so a batch that is
   * still growing is never disturbed.
   */
  private async syncBatchStage(
    scope: {
      plantStockId: string;
      tunnelId: string | null;
      sectorId: string | null;
    },
    db: Db = this.prismaService,
  ) {
    const batch = await db.plantStock.findUnique({
      where: { id: scope.plantStockId },
    });
    if (!batch) return;

    let expected = batch.expectedPlants;

    if (scope.tunnelId && batch.ssmSowingId) {
      const assignment = await db.sowingTunnelAssignment.findFirst({
        where: { ssmSowingId: batch.ssmSowingId, tunnelId: scope.tunnelId },
      });
      if (assignment) {
        expected = this.tunnelExpectedPlants(batch, assignment.numberOfTrays);
      }
    }

    const harvested = await db.harvestRecord.aggregate({
      where: {
        plantStockId: scope.plantStockId,
        tunnelId: scope.tunnelId,
        sectorId: scope.sectorId,
      },
      _sum: { totalPlants: true },
    });

    const remaining = expected - (harvested._sum.totalPlants ?? 0);

    if (remaining <= 0 && batch.currentStage !== 'HARVESTED') {
      await db.plantStock.update({
        where: { id: batch.id },
        data: { currentStage: 'HARVESTED' },
      });
    } else if (remaining > 0 && batch.currentStage === 'HARVESTED') {
      await db.plantStock.update({
        where: { id: batch.id },
        data: { currentStage: 'READY' },
      });
    }
  }

  /**
   * What one tunnel's share of a batch should yield (HARV-01).
   *
   * The trays in that tunnel × the batch's seeds per tray. When the batch did
   * not record a seeds-per-tray this used to multiply by 0, so `expected`
   * collapsed to nothing and **the first harvest of any size closed the batch** —
   * then deleting that harvest reopened it. Falling back to the batch's own
   * expected plants, split by trays where the tray count is known, keeps the
   * figure meaningful.
   *
   * Erring high is the safe direction: the batch simply stays open, which is
   * what a harvest nobody has logged yet looks like. Erring low silently hides
   * work still to come.
   */
  private tunnelExpectedPlants(
    batch: {
      expectedPlants: number;
      seedsPerTray: number | null;
      numberOfTrays: number | null;
    },
    traysInTunnel: number,
  ): number {
    if (batch.seedsPerTray && batch.seedsPerTray > 0) {
      return traysInTunnel * batch.seedsPerTray;
    }

    if (batch.numberOfTrays && batch.numberOfTrays > 0) {
      return batch.expectedPlants * (traysInTunnel / batch.numberOfTrays);
    }

    return batch.expectedPlants;
  }

  /** Finished-goods stock — what Shipment will draw from */
  async findAllProducts() {
    return this.prismaService.harvestedProduct.findMany({
      where: { seasonId: this.seasonService.getActiveSeasonId() },
      orderBy: { name: 'asc' },
      include: { _count: { select: { movements: true } } },
    });
  }

  /**
   * Finished-goods grouped by product + type + packing.
   * One card per (productName, targetType, stockType, plantsPerBox) group,
   * with summed boxes and total plants. Product name is matched
   * case-insensitively so "krypton" and "Krypton" merge into one card.
   */
  async findSummary() {
    const records = await this.prismaService.harvestRecord.findMany({
      where: { seasonId: this.seasonService.getActiveSeasonId() },
      select: {
        productName: true,
        planteCode: true,
        targetType: true,
        stockType: true,
        plantsPerBox: true,
        boxCount: true,
        totalPlants: true,
        harvestedAt: true,
      },
      orderBy: { harvestedAt: 'desc' },
    });

    const groups = new Map<
      string,
      {
        productName: string;
        planteCode: string;
        targetType: string;
        stockType: string | null;
        plantsPerBox: number;
        boxCount: number;
        totalPlants: number;
        lastHarvestedAt: Date;
      }
    >();

    for (const r of records) {
      const key = [
        r.productName.trim().toLowerCase(),
        r.planteCode,
        r.targetType,
        r.stockType ?? '',
        r.plantsPerBox,
      ].join('|');

      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          productName: r.productName,
          planteCode: r.planteCode,
          targetType: r.targetType,
          stockType: r.stockType,
          plantsPerBox: r.plantsPerBox,
          boxCount: r.boxCount,
          totalPlants: r.totalPlants,
          lastHarvestedAt: r.harvestedAt,
        });
      } else {
        existing.boxCount += r.boxCount;
        existing.totalPlants += r.totalPlants;
      }
    }

    return Array.from(groups.values()).sort((a, b) =>
      a.productName.localeCompare(b.productName),
    );
  }
}
