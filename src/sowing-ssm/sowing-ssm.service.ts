import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { ReferenceType } from '../stock/enums/reference-type.enum';
import { ExecuteSSMDto } from './dto/execute-ssm.dto';
import { UpdateSSMDto } from './dto/update-ssm.dto';
import { getPaginationParams } from '../common/pagination';
import { TRAYS_PER_PEAT_BALL, sameVariety } from '../common/sowing.constants';
import { SettingsService } from '../settings/settings.service';
import {
  assertEntrySowable,
  syncPlanEntryProgress,
} from '../sowing-plan/plan-entry-progress';
import { SeasonService } from '../season/season.service';
import { ERROR_MESSAGES } from '../common/error-messages';
import { STAGE_SEEDLING } from '../plant-stock/plant-stock.constants';
import type { Actor } from '../common/actor';
import { UNASSIGNED_LOCATION } from '../common/sowing.constants';

@Injectable()
export class SowingSSMService {
  constructor(
    private prismaService: PrismaService,
    private stockService: StockService,
    private seasonService: SeasonService,
    private settingsService: SettingsService,
  ) {}

  async execute(dto: ExecuteSSMDto, actor: Actor) {
    const {
      planId,
      planEntryId,
      tunnelId,
      variety,
      code,
      lotNumber,
      stockType: dtoStockType,
      peatLotNumber,
      peatStockType,
      numberOfTrays,
      seedsPerTray,
      sowingDate,
      remarks,
    } = dto;

    let stockType: string;

    // 1. Validate plan exists
    const plan = await this.prismaService.sowingPlan.findUnique({
      where: { id: planId },
      include: { season: { select: { code: true } } },
    });

    if (!plan) {
      throw new NotFoundException('This plan no longer exists.');
    }

    // A sowing is ALWAYS filed into the open season — that is the season
    // `getActiveSeasonId()` stamps it with — so executing a plan from another
    // season would put the plan's numbers in one season and the sowing's in
    // another, with nothing on screen saying so (SSM-01).
    //
    // Not a permission question, so there is no administrator exemption here:
    // the record that would be created is wrong for whoever creates it.
    if (plan.seasonId !== this.seasonService.getActiveSeasonId()) {
      throw new BadRequestException(
        `This plan belongs to season ${plan.season.code}, which is not the open season. A sowing is always recorded in the open season — use a plan from the current season.`,
      );
    }

    if (plan.planType !== 'SSM') {
      throw new BadRequestException(
        'This is a field (LPM) plan. Please choose a tunnel (SSM) plan.',
      );
    }

    // 2. Validate plan entry if provided
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
    } else {
      if (!dtoStockType) {
        throw new BadRequestException(
          'stockType is required when not executing from a plan entry',
        );
      }
      stockType = dtoStockType;
    }

    // 3. Validate tunnel exists (only if provided)
    const tunnel = tunnelId
      ? await this.prismaService.tunnel.findUnique({
          where: { id: tunnelId },
        })
      : null;

    if (tunnelId && !tunnel) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    // 3. Calculate
    //
    // The figures the FARM uses today come from the settings, not from the compiled
    // constants: a new sowing follows the current setting, while the row stores what
    // it actually used, so no later change can rewrite this record (SOW-11).
    const sPerTray =
      seedsPerTray ??
      (await this.settingsService.get('DEFAULT_SEEDS_PER_TRAY'));
    const traysPerBall = await this.settingsService.get('TRAYS_PER_PEAT_BALL');
    const peatUsed = numberOfTrays / traysPerBall;
    const quantityUsed = numberOfTrays * sPerTray;

    // The sowing date must belong to the season this sowing is filed into
    // (SEASON-08).
    await this.seasonService.assertDateInSeason(sowingDate, 'sowing date');

    // 4. Transaction: deduct stock + create sowing + create plantStock
    return this.prismaService.$transaction(async (tx) => {
      // Deduct SEEDS stock
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

      // Deduct PEAT stock from the pool the operator picked (SSM always uses
      // peat). Peat is tracked in big-ball units; the figure was worked out above,
      // outside this transaction, and the row stores it so that the reversal can
      // return exactly what left the pool (SOW-11).
      await this.stockService.removeStock(
        {
          lotNumber: peatLotNumber,
          stockType: peatStockType,
          productType: 'PEAT',
          quantity: peatUsed,
          referenceId: planEntryId,
          referenceType: ReferenceType.SOWING,
          createdByName: actor.name,
        },
        tx,
      );

      // Create SowingSSM
      const sowing = await tx.sowingSSM.create({
        data: {
          seasonId: this.seasonService.getActiveSeasonId(),
          planId,
          planEntryId: planEntryId ?? null,
          variety,
          code: code,
          sowingDate,
          lotNumber,
          stockType: stockType,
          productType: 'SEEDS',
          peatLotNumber,
          peatStockType,
          peatUsed,
          numberOfTrays,
          seedsPerTray: sPerTray,
          quantityUsed,
          tunnelId: tunnelId ?? null,
          remarks,
        },
      });

      // Create PlantStock
      await tx.plantStock.create({
        data: {
          ssmSowingId: sowing.id,
          variety,
          code: code ?? null,
          location: tunnel?.number ?? UNASSIGNED_LOCATION,
          lotNumber,
          stockType: stockType,
          numberOfTrays,
          seedsPerTray: sPerTray,
          expectedPlants: quantityUsed,
          seedsSown: quantityUsed,
          currentStage: STAGE_SEEDLING,
        },
      });

      // Update plan entry progress (if from a plan)
      if (planEntryId) {
        await syncPlanEntryProgress(tx, planEntryId);
      }

      return tx.sowingSSM.findUnique({
        where: { id: sowing.id },
        include: {
          plantStock: true,
          tunnel: true,
        },
      });
    });
  }

  async findAll(q?: string, page?: string, pageSize?: string) {
    const seasonId = this.seasonService.getActiveSeasonId();
    const where = q
      ? {
          seasonId,
          OR: [
            { variety: { contains: q, mode: 'insensitive' as const } },
            { lotNumber: { contains: q, mode: 'insensitive' as const } },
            { stockType: { contains: q, mode: 'insensitive' as const } },
            { remarks: { contains: q, mode: 'insensitive' as const } },
          ].filter(Boolean),
        }
      : { seasonId };

    const pagination = getPaginationParams(page, pageSize);

    if (pagination) {
      const [total, items] = await Promise.all([
        this.prismaService.sowingSSM.count({ where }),
        this.prismaService.sowingSSM.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: pagination.skip,
          take: pagination.take,
          include: {
            plantStock: true,
            tunnel: true,
            plan: true,
            tunnelAssignments: {
              include: { tunnel: true },
            },
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

    return this.prismaService.sowingSSM.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        plantStock: true,
        tunnel: true,
        plan: true,
        tunnelAssignments: {
          include: { tunnel: true },
        },
      },
    });
  }

  async findOne(id: string) {
    const sowing = await this.prismaService.sowingSSM.findUnique({
      where: { id },
      include: {
        plantStock: true,
        tunnel: true,
        tunnelAssignments: {
          include: { tunnel: true },
        },
        planEntry: { include: { plan: true } },
      },
    });

    if (!sowing) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    return sowing;
  }

  async update(id: string, dto: UpdateSSMDto, actor: Actor) {
    const existing = await this.findOne(id);

    // Every field is optional now (SSM-03), so "not sent" has to mean "keep what
    // is there" rather than "write undefined". The tunnel is the one field that
    // can be cleared deliberately, by sending `null`.
    const variety = dto.variety ?? existing.variety;
    const lotNumber = dto.lotNumber ?? existing.lotNumber;
    const peatLotNumber = dto.peatLotNumber ?? existing.peatLotNumber;
    const peatStockType = dto.peatStockType ?? existing.peatStockType;
    const numberOfTrays = dto.numberOfTrays ?? existing.numberOfTrays;
    const sowingDate = dto.sowingDate ?? existing.sowingDate;
    const remarks = dto.remarks === undefined ? existing.remarks : dto.remarks;
    const code = dto.code ?? existing.code;
    const sPerTray = dto.seedsPerTray ?? existing.seedsPerTray;

    const tunnelChanged = dto.tunnelId !== undefined;
    const tunnelId = tunnelChanged ? dto.tunnelId : existing.tunnelId;

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

    const newQuantity = numberOfTrays * sPerTray;
    // Same reasoning as in `execute`: the current setting decides the new figure,
    // and the row stores it — worked out here so the transaction holds no read open.
    const traysPerBall = await this.settingsService.get('TRAYS_PER_PEAT_BALL');
    const newPeatUsed = numberOfTrays / traysPerBall;

    // The tunnel row is needed for its NUMBER: the sowing keeps a denormalised
    // copy of it for the screens and for the plan's location (SSM-04).
    const tunnel = tunnelId
      ? await this.prismaService.tunnel.findUnique({ where: { id: tunnelId } })
      : null;

    if (tunnelId && !tunnel) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
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
      // Reverse old peat (big-ball units) — into the pool this sowing used.
      //
      // What it ACTUALLY took, not what today's constant would say: those two
      // differ the moment the trays-per-ball figure is ever changed, and the stock
      // this returns has to match the stock that left (SOW-11). The fallback only
      // covers rows the backfill has not reached yet.
      const oldPeatUsed =
        existing.peatUsed ?? existing.numberOfTrays / TRAYS_PER_PEAT_BALL;
      await this.stockService.addStock(
        {
          lotNumber: existing.peatLotNumber,
          stockType: existing.peatStockType,
          productType: 'PEAT',
          quantity: oldPeatUsed,
          referenceId: existing.planEntryId ?? existing.id,
          referenceType: ReferenceType.SOWING,
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
          quantity: newQuantity,
          referenceId: existing.planEntryId ?? existing.id,
          referenceType: ReferenceType.SOWING,
          seasonId: existing.seasonId,
          createdByName: actor.name,
        },
        tx,
      );
      // Deduct new peat (big-ball units) — from the pool the request names. The
      // figure was worked out above, outside this transaction (SOW-11).
      await this.stockService.removeStock(
        {
          lotNumber: peatLotNumber,
          stockType: peatStockType,
          productType: 'PEAT',
          quantity: newPeatUsed,
          referenceId: existing.planEntryId ?? existing.id,
          referenceType: ReferenceType.SOWING,
          seasonId: existing.seasonId,
          createdByName: actor.name,
        },
        tx,
      );

      // Update sowing
      await tx.sowingSSM.update({
        where: { id },
        data: {
          variety,
          code,
          sowingDate,
          lotNumber,
          peatLotNumber,
          peatStockType,
          numberOfTrays,
          seedsPerTray: sPerTray,
          quantityUsed: newQuantity,
          // What every future reversal returns — the figure just deducted above,
          // not one derived again later (SOW-11).
          peatUsed: newPeatUsed,
          remarks,
          // Only when the tunnel was actually part of the request: `undefined`
          // tells Prisma to leave the column alone, which is what "not sent"
          // has to mean for the denormalised copy too (SSM-04). `tunnelNumber`
          // is what the plan's location and the tray-transport screens read, so
          // it follows the tunnel instead of keeping the old one.
          tunnelId: tunnelChanged ? tunnelId : undefined,
          tunnelNumber: tunnelChanged ? (tunnel?.number ?? null) : undefined,
        },
      });

      if (existing.plantStock) {
        await tx.plantStock.update({
          where: { id: existing.plantStock.id },
          data: {
            variety,
            code,
            location: tunnelChanged
              ? (tunnel?.number ?? UNASSIGNED_LOCATION)
              : existing.plantStock.location,
            lotNumber,
            numberOfTrays,
            seedsPerTray: sPerTray,
            expectedPlants: newQuantity,
            // `expectedPlants` used to move while `seedsSown` stayed where it
            // was, and germination is calculated by dividing the plants counted
            // by `seedsSown` — so after any edit the germination figure
            // described a sowing that no longer existed (SSM-05).
            seedsSown: newQuantity,
          },
        });
      }

      if (existing.planEntryId) {
        await syncPlanEntryProgress(tx, existing.planEntryId);
      }

      return tx.sowingSSM.findUnique({
        where: { id },
        include: { plantStock: true, tunnel: true },
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
      // Reverse peat (big-ball units) — into the pool this sowing used.
      //
      // The stored figure, for the same reason as in `update`: it is what left the
      // pool, and the constant may have moved since (SOW-11).
      const peatToReverse =
        existing.peatUsed ?? existing.numberOfTrays / TRAYS_PER_PEAT_BALL;
      await this.stockService.addStock(
        {
          lotNumber: existing.peatLotNumber,
          stockType: existing.peatStockType,
          productType: 'PEAT',
          quantity: peatToReverse,
          referenceId: existing.planEntryId ?? existing.id,
          referenceType: ReferenceType.SOWING,
          seasonId: existing.seasonId,
          createdByName: actor.name,
        },
        tx,
      );

      // Update plan entry progress (decrement executed count)

      const deleted = await tx.sowingSSM.delete({ where: { id } });

      if (existing.planEntryId) {
        await syncPlanEntryProgress(tx, existing.planEntryId);
      }
      return deleted;
    });
  }
}
