import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../common/actor';
import { getPaginationParams } from '../common/pagination';
import { derivePlanteCode } from '../common/harvest-naming';
import { predictedPlantsForTrays } from '../common/harvest-expectation';
import { CreateHarvestRecordDto } from './dto/harvest.dto';
import { WriteOffHarvestDto } from './dto/writeoff-harvest.dto';
import { SeasonService } from '../season/season.service';
import { HarvestReferenceType } from '../common/enums/ledger-reference-type.enum';
import { ERROR_MESSAGES } from '../common/error-messages';
import {
  STAGE_HARVESTED,
  STAGE_SEEDLING,
} from '../plant-stock/plant-stock.constants';
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
        // `sectorId` is what ties the batch to the sector it was sown into. It
        // is selected here because the sector check below needs it — without
        // it the sector was taken on trust.
        lpmSowing: { select: { seasonId: true, sectorId: true } },
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
        select: { id: true, number: true, seasonId: true },
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

      // A harvest bigger than what is standing there is refused (HARV-07).
      await this.assertHarvestFits(
        {
          plantStockId: batch.id,
          tunnelId: tunnel.id,
          sectorId: null,
          tunnelNumber: tunnel.number,
          placeName: tunnel.number,
        },
        dto,
        label,
      );
    } else {
      const sector = await this.prismaService.sector.findUnique({
        where: { id: dto.sectorId },
        select: { seasonId: true, name: true },
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

      // A batch may only be harvested from the sector its sowing names — the
      // same rule the tunnel branch above applies, and the same one both
      // clients already filter their batch list by. The sector used to be
      // taken on trust: a harvest could be filed against a sector the batch
      // was never in, which named the wrong place AND left the batch's own
      // plant-stock figures (they key on the sector its SOWING names)
      // untouched — two screens disagreeing, with nothing to say which was
      // right.
      //
      // Compared by ID, never by name: `PlantStock.location` is a copy of the
      // sector name taken at sowing, and a sector can be renamed, so a name
      // comparison would start refusing legitimate harvests the day one was.
      // `SowingLPM.sectorId` is the real link and never changes.
      if (batch.lpmSowing?.sectorId !== dto.sectorId) {
        throw new BadRequestException(
          `Batch ${label} is not in the selected sector.`,
        );
      }

      // The same over-harvest guard the tunnel half uses (HARV-07/08). A sector
      // only gets one when it has been COUNTED: its `expectedPlants` is a seed
      // figure, so judging against it would let almost anything through. Where
      // there is a measurement, the guard stands on it; where there is not, it
      // stays out of the way rather than pretending.
      await this.assertHarvestFits(
        {
          plantStockId: batch.id,
          tunnelId: null,
          sectorId: dto.sectorId ?? null,
          placeName: sector.name,
        },
        dto,
        label,
      );
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
        // Refuse rather than clamp. Clamping to zero used to hide the problem:
        // the goods had already shipped, so the stock figure silently became
        // wrong instead of telling anyone.
        //
        // The condition sits in the UPDATE rather than in a read taken before it,
        // so Postgres re-checks it against the very row it locks: of two deletes
        // arriving together, the first takes the plants and the second matches
        // nothing, instead of both passing the same check and taking them twice.
        // A shipment has been guarded this way since SHIP-01; this was the copy
        // that did not get it.
        const reversed = await tx.harvestedProduct.updateMany({
          where: {
            id: product.id,
            currentQuantity: { gte: record.totalPlants },
          },
          data: { currentQuantity: { decrement: record.totalPlants } },
        });

        if (reversed.count === 0) {
          const now = await tx.harvestedProduct.findUnique({
            where: { id: product.id },
            select: { currentQuantity: true },
          });

          throw new BadRequestException(
            `Only ${(now?.currentQuantity ?? 0).toLocaleString('en-GB')} ${product.name} are left in stock, but removing this harvest would take out ${record.totalPlants.toLocaleString('en-GB')}. Delete or reduce the shipments that used them first.`,
          );
        }

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
    return this.prismaService.$transaction(async (tx) => {
      // Read INSIDE the transaction. A figure read before it is stale by the time
      // the write happens — and it is the write, not the read, that the movement
      // below goes on to record.
      const product = await tx.harvestedProduct.findUnique({
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

      // Empty the shelf only while it still holds the figure just read. Of two
      // write-offs arriving together, one empties it and the other matches
      // nothing. An unconditional write to 0 let BOTH record a full-size
      // movement for a drop that only happened once, which leaves the ledger
      // unable to explain the quantity it exists to explain.
      const emptied = await tx.harvestedProduct.updateMany({
        where: { id: product.id, currentQuantity: writtenOff },
        data: { currentQuantity: 0 },
      });

      if (emptied.count === 0) {
        throw new BadRequestException(
          `The stock of ${product.name} changed while it was being written off. Look at it again and try once more.`,
        );
      }

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
   * What is standing in ONE place, and how much of it has already been taken.
   *
   * ONE definition, two callers (HARV-07): the stage flip below, and the guard
   * that refuses an over-harvest. They used to be separate sums, and the
   * plant-stock screen had a third — which is how a screen comes to say "800
   * left" and the server then refuses a harvest of 500. The arithmetic lives in
   * `common/harvest-expectation.ts`; this owns which trays and which harvests
   * belong to the scope.
   *
   * The expected figure, in order of what is actually known:
   *   1. the latest plant COUNT taken in this tunnel — a measurement, not a
   *      forecast (HARV-07: a count that came out ABOVE the prediction raises
   *      the ceiling, so a batch that germinated better than forecast can still
   *      be harvested in full);
   *   2. the trays in this tunnel × the batch's seeds per tray;
   *   3. the batch's own expectation.
   *
   * It never drops BELOW (2): a harvest is judged against the larger of what was
   * measured and what was predicted, so the guard can never refuse a harvest
   * smaller than the "remaining" the plant-stock screen is showing.
   *
   * The scope is per place, not per batch: a batch split over two tunnels has a
   * budget in each, which is what the screen shows and what lets one tunnel be
   * finished while the other still grows.
   */
  private async standingIn(
    scope: {
      plantStockId: string;
      tunnelId: string | null;
      sectorId: string | null;
    },
    db: Db = this.prismaService,
    /** The tunnel's number, needed to find its count. Omit to skip the count. */
    tunnelNumber?: string,
  ) {
    const batch = await db.plantStock.findUnique({
      where: { id: scope.plantStockId },
    });
    if (!batch) return null;

    let expected: number | null = batch.expectedPlants;

    if (scope.tunnelId && batch.ssmSowingId) {
      const assignment = await db.sowingTunnelAssignment.findFirst({
        where: { ssmSowingId: batch.ssmSowingId, tunnelId: scope.tunnelId },
      });
      // No assignment means nothing has been transported yet, so the batch is
      // still whole in its planned location.
      const trays = assignment
        ? assignment.numberOfTrays
        : (batch.numberOfTrays ?? null);

      if (trays != null) expected = predictedPlantsForTrays(batch, trays);

      if (tunnelNumber) {
        // A count is filed against the tunnel's NUMBER, not its id — the count
        // table has no tunnel column. 'TRAY' is the SSM count type.
        const measured = await db.plantCount.findFirst({
          where: {
            plantStockId: batch.id,
            countType: 'TRAY',
            location: tunnelNumber,
          },
          orderBy: { countDate: 'desc' },
          select: { estimatedPlants: true },
        });

        if (measured) expected = Math.max(expected, measured.estimatedPlants);
      }
    } else if (scope.sectorId && batch.lpmSowingId) {
      // A SECTOR has no forecast to fall back on: `expectedPlants` on an LPM
      // batch holds the SEED count, so subtracting what has been harvested from
      // it compares two different things. Left alone, a sector batch could
      // never be finished — it would take harvesting as many plants as there
      // were seeds, which is more than ever grew (HARV-08).
      //
      // So a sector is judged on a MEASUREMENT or not at all. The count walks
      // one metre of a row and the app works a whole line out of it (a count's
      // scope is one line, all seven rows), so the field is that figure times
      // the lines sown.
      const measured = await db.plantCount.findFirst({
        // A sector count is filed under the batch's own location — the sector
        // name it was sown with — which is how `saveCount` keys it, so a sector
        // renamed since sowing still finds its own counts.
        where: {
          plantStockId: batch.id,
          countType: 'ROW_METRE',
          location: batch.location,
        },
        orderBy: { countDate: 'desc' },
        select: { estimatedPlants: true },
      });

      expected = measured
        ? measured.estimatedPlants * (batch.lines ?? 1)
        : null;
    }

    const taken = await db.harvestRecord.aggregate({
      where: {
        plantStockId: scope.plantStockId,
        tunnelId: scope.tunnelId,
        sectorId: scope.sectorId,
      },
      _sum: { totalPlants: true },
    });

    const harvested = taken._sum.totalPlants ?? 0;

    return {
      batch,
      expected,
      harvested,
      remaining: expected == null ? null : expected - harvested,
    };
  }

  /**
   * Refuse a harvest bigger than what is standing in that place (HARV-07/08).
   *
   * Every other stock rule in this module refuses rather than clamping — a
   * deleted harvest that would push stock below zero is refused, and a shipment
   * that would overdraw its pool is refused — but the harvest ENTRY accepted any
   * figure at all. Finished goods then held plants that were never grown, and
   * that is not merely a wrong figure on a screen: shipments draw from that
   * pool, so an over-harvest authorised boxes that did not exist.
   *
   * A place with nothing measured has no guard: an uncounted sector is judged on
   * nothing rather than on a seed count that would wave everything through.
   *
   * Checked before the transaction — it is a pure read, so there is nothing to
   * roll back.
   */
  private async assertHarvestFits(
    scope: {
      plantStockId: string;
      tunnelId: string | null;
      sectorId: string | null;
      /** The tunnel's number, which is how its counts are filed. */
      tunnelNumber?: string;
      /** What the message calls the place — a tunnel number, a sector name. */
      placeName: string;
    },
    dto: CreateHarvestRecordDto,
    label: string,
  ) {
    const standing = await this.standingIn(
      {
        plantStockId: scope.plantStockId,
        tunnelId: scope.tunnelId,
        sectorId: scope.sectorId,
      },
      this.prismaService,
      scope.tunnelNumber,
    );
    if (!standing || standing.remaining == null) return;

    const wanted = dto.boxCount * dto.plantsPerBox;
    if (wanted <= standing.remaining) return;

    const fmt = (n: number) => n.toLocaleString('en-GB');

    throw new BadRequestException(
      `Only ${fmt(standing.remaining)} plants of ${label} are still standing in ${scope.placeName}, but this harvest takes ${fmt(wanted)}. Check the box count — or that they were harvested in this place.`,
    );
  }

  /**
   * Mark a batch HARVESTED once nothing of it is left, and put it back to
   * SEEDLING if a harvest is removed again.
   *
   * Those two ARE the whole vocabulary (PSTOCK-05, `PLANT_STAGES`): a batch is
   * either growing or finished, and this is the only thing that moves it between
   * the two. It used to say `READY` when a harvest was taken back, which was a
   * third word nothing else knew — the plant-stock screens showed it raw.
   *
   * "Remaining" is derived from the harvest records and never stored, so it is
   * recomputed here — by `standingIn`, the same sum the over-harvest guard
   * refuses against, so the two can never disagree (HARV-07).
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
    const standing = await this.standingIn(scope, db);
    if (!standing) return;

    const { batch, remaining } = standing;

    // Nothing measured means nothing to judge: an uncounted sector keeps the
    // stage it has, rather than being called finished — or still growing — on
    // the strength of a seed count.
    if (remaining == null) return;

    if (remaining <= 0 && batch.currentStage !== STAGE_HARVESTED) {
      await db.plantStock.update({
        where: { id: batch.id },
        data: { currentStage: STAGE_HARVESTED },
      });
    } else if (remaining > 0 && batch.currentStage === STAGE_HARVESTED) {
      await db.plantStock.update({
        where: { id: batch.id },
        data: { currentStage: STAGE_SEEDLING },
      });
    }
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
