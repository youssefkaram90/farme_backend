import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { StockService } from '../stock/stock.service';
import { ReferenceType } from '../stock/enums/reference-type.enum';
import { ExecuteLPMDto } from './dto/execute-lpm.dto';
import { UpdateLPMDto } from './dto/update-lpm.dto';
import { getPaginationParams } from '../common/pagination';
import {
  deriveSeedsPerRowMetre,
  sameVariety,
} from '../common/sowing.constants';
import {
  assertEntrySowable,
  syncPlanEntryProgress,
} from '../sowing-plan/plan-entry-progress';
import { SeasonService } from '../season/season.service';
import type { Actor } from '../common/actor';
import { ERROR_MESSAGES } from '../common/error-messages';

@Injectable()
export class SowingLPMService {
  constructor(
    private prismaService: PrismaService,
    private stockService: StockService,
    private seasonService: SeasonService,
  ) {}

  async execute(dto: ExecuteLPMDto, actor: Actor) {
    const {
      planId,
      planEntryId,
      sectorId: dtoSectorId,
      variety,
      lotNumber,
      stockType: dtoStockType,
      quantityUsed,
      sowingDate,
      lines,
      meterPerLine,
      remarks,
    } = dto;
    const seedsPerMeter = deriveSeedsPerRowMetre(
      quantityUsed,
      lines,
      meterPerLine,
    );
    let stockType: string;
    let sectorId: string | undefined = dtoSectorId;

    // 1. Validate plan exists
    const plan = await this.prismaService.sowingPlan.findUnique({
      where: { id: planId },
      include: { season: { select: { code: true } } },
    });

    if (!plan) {
      throw new NotFoundException('This plan no longer exists.');
    }

    // A sowing is ALWAYS filed into the open season, so executing a plan from
    // another season would split the plan's numbers and the sowing's numbers
    // across two seasons, with nothing on screen saying so (SSM-01). Not a
    // permission question, so no administrator exemption: the record would be
    // wrong for whoever created it.
    if (plan.seasonId !== this.seasonService.getActiveSeasonId()) {
      throw new BadRequestException(
        `This plan belongs to season ${plan.season.code}, which is not the open season. A sowing is always recorded in the open season — use a plan from the current season.`,
      );
    }

    if (plan.planType !== 'LPM') {
      throw new BadRequestException(
        'This is a tunnel (SSM) plan. Please choose a field (LPM) plan.',
      );
    }

    // 2. Validate plan entry if provided — auto-fill from entry
    if (planEntryId) {
      const planEntry = await this.prismaService.sowingPlanEntry.findUnique({
        where: { id: planEntryId },
        include: { plan: true },
      });

      if (!planEntry) {
        throw new NotFoundException('This plan entry no longer exists.');
      }

      if (planEntry.planId !== planId) {
        throw new BadRequestException(
          'This plan entry does not belong to the selected plan.',
        );
      }

      // Refuses an entry that is already fully sown, one an administrator closed
      // on purpose, and a plan declared complete — the same shared rule in both
      // sowing paths (SPLAN-02).
      assertEntrySowable(planEntry, planEntry.plan.status);

      if (!sameVariety(planEntry.variety, variety)) {
        throw new BadRequestException(
          `This entry must be sown with the planned variety "${planEntry.variety}".`,
        );
      }

      // The actual execution may differ from the plan (including exceeding it).
      // The plan is a forecast, not a hard limit.
      stockType = planEntry.stockType;

      // Auto-fill sectorId from plan entry if not explicitly provided
      if (!sectorId && planEntry.sectorId) {
        sectorId = planEntry.sectorId;
      }
    } else {
      if (!dtoStockType) {
        throw new BadRequestException(
          'stockType is required when not executing from a plan entry',
        );
      }
      stockType = dtoStockType;
    }

    // 3. Validate LPM-specific fields
    if (!lines) {
      throw new BadRequestException('Please enter the number of lines.');
    }
    if (!meterPerLine) {
      throw new BadRequestException('Please enter the length of the lines.');
    }

    // 4. Validate sector if sectorId is provided
    let sectorName = '';
    if (sectorId) {
      const sector = await this.prismaService.sector.findUnique({
        where: { id: sectorId },
      });

      if (!sector) {
        throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
      }
      sectorName = sector.name;
    }

    // The sowing date must belong to the season this sowing is filed into
    // (SEASON-08).
    await this.seasonService.assertDateInSeason(sowingDate, 'sowing date');

    // 3. Transaction: deduct stock + create sowing + create plantStock
    return this.prismaService.$transaction(async (tx) => {
      // Deduct SEEDS stock only (LPM = seeds only, no peat)
      await this.stockService.removeStock(
        {
          lotNumber,
          productType: 'SEEDS',
          stockType: stockType,
          quantity: quantityUsed,
          referenceId: planEntryId ?? undefined,
          referenceType: ReferenceType.SOWING,
          createdByName: actor.name,
        },
        tx,
      );

      // Create SowingLPM
      const sowing = await tx.sowingLPM.create({
        data: {
          seasonId: this.seasonService.getActiveSeasonId(),
          planId,
          planEntryId: planEntryId ?? null,
          variety,
          sowingDate,
          lotNumber,
          stockType: stockType,
          productType: 'SEEDS',
          quantityUsed,
          sectorId,
          lines,
          meterPerLine,
          seedsPerMeter,
          remarks,
        },
      });

      // Create PlantStock
      await tx.plantStock.create({
        data: {
          lpmSowingId: sowing.id,
          variety,
          location: sectorName,
          lotNumber,
          stockType: stockType,
          lines,
          meterPerLine,
          seedsPerMeter,
          expectedPlants: quantityUsed,
          seedsSown: quantityUsed,
          currentStage: 'SEEDLING',
        },
      });

      // Update plan entry progress (if from a plan)
      if (planEntryId) {
        await syncPlanEntryProgress(tx, planEntryId);
      }

      return tx.sowingLPM.findUnique({
        where: { id: sowing.id },
        include: {
          plantStock: true,
          sector: true,
        },
      });
    });
  }

  async findAll(q?: string, planId?: string, page?: string, pageSize?: string) {
    // Typed, not `any`: the `any` is what let an invalid filter live here —
    // `lines` is an `Int?` and was being searched with `contains` and
    // `mode: 'insensitive'`, which Prisma refuses for a number, so any search
    // text that reached this query killed the whole list request instead of
    // returning rows (LPM-01).
    const where: Prisma.SowingLPMWhereInput = {
      seasonId: this.seasonService.getActiveSeasonId(),
    };

    if (planId) {
      where.planId = planId;
    }

    if (q) {
      where.OR = [
        { variety: { contains: q, mode: 'insensitive' as const } },
        { lotNumber: { contains: q, mode: 'insensitive' as const } },
        { stockType: { contains: q, mode: 'insensitive' as const } },
        { remarks: { contains: q, mode: 'insensitive' as const } },
        { sector: { name: { contains: q, mode: 'insensitive' as const } } },
      ];
    }

    const pagination = getPaginationParams(page, pageSize);

    if (pagination) {
      const [total, items] = await Promise.all([
        this.prismaService.sowingLPM.count({ where }),
        this.prismaService.sowingLPM.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: pagination.skip,
          take: pagination.take,
          include: {
            plantStock: true,
            sector: true,
            plan: true,
          },
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

    return this.prismaService.sowingLPM.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        plantStock: true,
        sector: true,
        plan: true,
      },
    });
  }

  async findOne(id: string) {
    const sowing = await this.prismaService.sowingLPM.findUnique({
      where: { id },
      include: {
        plantStock: true,
        sector: true,
        planEntry: { include: { plan: true } },
      },
    });

    if (!sowing) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    return sowing;
  }

  async update(id: string, dto: UpdateLPMDto, actor: Actor) {
    const existing = await this.findOne(id);

    // Every field is optional now (SSM-03), so "not sent" must mean "keep",
    // never "write undefined". The sector is the one field that can be cleared
    // deliberately, by sending `null`.
    const variety = dto.variety ?? existing.variety;
    const lotNumber = dto.lotNumber ?? existing.lotNumber;
    const quantityUsed = dto.quantityUsed ?? existing.quantityUsed;
    const sowingDate = dto.sowingDate ?? existing.sowingDate;
    const lines = dto.lines ?? existing.lines;
    const meterPerLine = dto.meterPerLine ?? existing.meterPerLine;
    const remarks = dto.remarks === undefined ? existing.remarks : dto.remarks;

    const sectorChanged = dto.sectorId !== undefined;
    const sectorId = sectorChanged ? dto.sectorId : existing.sectorId;

    if (existing.planEntryId) {
      const planEntry = await this.prismaService.sowingPlanEntry.findUnique({
        where: { id: existing.planEntryId },
      });
      if (planEntry && !sameVariety(planEntry.variety, variety)) {
        throw new BadRequestException(
          `Variety "${variety}" does not match the plan entry variety "${planEntry.variety}"`,
        );
      }
    }

    // The sector row is needed for its NAME: the plant stock row stores the
    // sector name as its location.
    const sector = sectorId
      ? await this.prismaService.sector.findUnique({ where: { id: sectorId } })
      : null;

    if (sectorId && !sector) {
      throw new NotFoundException('This sector no longer exists.');
    }

    return this.prismaService.$transaction(async (tx) => {
      // Reverse old stock
      await this.stockService.addStock(
        {
          lotNumber: existing.lotNumber,
          productType: 'SEEDS',
          stockType: existing.stockType,
          quantity: existing.quantityUsed,
          referenceId: existing.planEntryId ?? existing.id,
          referenceType: ReferenceType.SOWING,
          // The sowing's own season, not the open one (DELIV-07).
          seasonId: existing.seasonId,
          createdByName: actor.name,
        },
        tx,
      );

      // Apply new stock deduction
      await this.stockService.removeStock(
        {
          lotNumber,
          productType: 'SEEDS',
          stockType: existing.stockType,
          quantity: quantityUsed,
          referenceId: existing.planEntryId ?? existing.id,
          referenceType: ReferenceType.SOWING,
          seasonId: existing.seasonId,
          createdByName: actor.name,
        },
        tx,
      );

      // Update sowing
      await tx.sowingLPM.update({
        where: { id },
        data: {
          variety,
          sowingDate,
          lotNumber,
          quantityUsed,
          lines,
          meterPerLine,
          seedsPerMeter: deriveSeedsPerRowMetre(
            quantityUsed,
            lines,
            meterPerLine,
          ),
          remarks,
          // `undefined` leaves the column alone; `null` takes the sowing out of
          // its sector.
          sectorId: sectorChanged ? sectorId : undefined,
        },
      });

      if (existing.plantStock) {
        await tx.plantStock.update({
          where: { id: existing.plantStock.id },
          data: {
            variety,
            location: sectorChanged
              ? (sector?.name ?? existing.plantStock.location)
              : existing.plantStock.location,
            lotNumber,
            lines,
            meterPerLine,
            seedsPerMeter: deriveSeedsPerRowMetre(
              quantityUsed,
              lines,
              meterPerLine,
            ),
            // Both move together: `seedsSown` is the denominator of every
            // germination figure, so leaving it behind made the counts describe
            // a sowing that no longer existed (SSM-05, same defect as SSM).
            expectedPlants: quantityUsed,
            seedsSown: quantityUsed,
          },
        });
      }

      if (existing.planEntryId) {
        await syncPlanEntryProgress(tx, existing.planEntryId);
      }

      return tx.sowingLPM.findUnique({
        where: { id },
        include: { plantStock: true, sector: true },
      });
    });
  }

  async remove(id: string, actor: Actor) {
    const existing = await this.findOne(id);

    return this.prismaService.$transaction(async (tx) => {
      // Reverse stock deduction
      await this.stockService.addStock(
        {
          lotNumber: existing.lotNumber,
          productType: 'SEEDS',
          stockType: existing.stockType,
          quantity: existing.quantityUsed,
          referenceId: existing.planEntryId ?? existing.id,
          referenceType: ReferenceType.SOWING,
          // The sowing's own season, not the open one (DELIV-07).
          seasonId: existing.seasonId,
          createdByName: actor.name,
        },
        tx,
      );

      // Update plan entry progress (decrement executed count)

      const deleted = await tx.sowingLPM.delete({ where: { id } });

      if (existing.planEntryId) {
        await syncPlanEntryProgress(tx, existing.planEntryId);
      }

      return deleted;
    });
  }
}
