import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { ReferenceType } from '../stock/enums/reference-type.enum';
import { ExecuteSSMDto } from './dto/execute-ssm.dto';

const DEFAULT_SEEDS_PER_TRAY = 285;

@Injectable()
export class SowingSSMService {
  constructor(
    private prismaService: PrismaService,
    private stockService: StockService,
  ) {}

  async execute(dto: ExecuteSSMDto) {
    const {
      planId,
      planEntryId,
      tunnelId,
      variety,
      lotNumber,
      stockType: dtoStockType,
      numberOfTrays,
      seedsPerTray,
      sowingDate,
      remarks,
    } = dto;

    let stockType: string;

    // 1. Validate plan exists
    const plan = await this.prismaService.sowingPlan.findUnique({
      where: { id: planId },
    });

    if (!plan) {
      throw new NotFoundException(`Plan with ID ${planId} not found`);
    }

    if (plan.planType !== 'SSM') {
      throw new BadRequestException(`Plan ${planId} is not an SSM plan`);
    }

    // 2. Validate plan entry if provided
    if (planEntryId) {
      const planEntry = await this.prismaService.sowingPlanEntry.findUnique({
        where: { id: planEntryId },
        include: { plan: true },
      });

      if (!planEntry) {
        throw new NotFoundException(
          `Plan entry with ID ${planEntryId} not found`,
        );
      }

      if (planEntry.planId !== planId) {
        throw new BadRequestException(
          `Plan entry ${planEntryId} does not belong to plan ${planId}`,
        );
      }

      if (planEntry.status === 'EXECUTED') {
        throw new BadRequestException(
          `Plan entry ${planEntryId} is already fully executed`,
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
      throw new NotFoundException(`Tunnel with ID ${tunnelId} not found`);
    }

    // 3. Calculate
    const sPerTray = seedsPerTray ?? DEFAULT_SEEDS_PER_TRAY;
    const quantityUsed = numberOfTrays * sPerTray;

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
        },
        tx,
      );

      // Deduct PEAT stock from pooled PEAT inventory (SSM always uses peat)
      // Peat is tracked in big-ball units: 1 ball = 380 trays
      const peatUsed = numberOfTrays / 380;
      await this.stockService.removeStock(
        {
          lotNumber: 'PEAT',
          productType: 'PEAT',
          stockType: 'GENERIC',
          quantity: peatUsed,
          referenceId: planEntryId,
          referenceType: ReferenceType.SOWING,
        },
        tx,
      );

      // Create SowingSSM
      const sowing = await tx.sowingSSM.create({
        data: {
          planId,
          planEntryId: planEntryId ?? null,
          variety,
          sowingDate,
          lotNumber,
          stockType: stockType,
          productType: 'SEEDS',
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
          location: tunnel?.number ?? 'Not assigned',
          lotNumber,
          stockType: stockType,
          numberOfTrays,
          seedsPerTray: sPerTray,
          expectedPlants: quantityUsed,
          seedsSown: quantityUsed,
          currentStage: 'SEEDLING',
        },
      });

      // Update plan entry progress (if from a plan)
      if (planEntryId) {
        const entry = await tx.sowingPlanEntry.findUnique({
          where: { id: planEntryId },
        });

        if (entry) {
          const newExecutedTrays = (entry.executedTrays ?? 0) + numberOfTrays;
          const plannedTrays = entry.plannedTrays ?? 0;

          let newStatus: string;
          if (plannedTrays > 0 && newExecutedTrays >= plannedTrays) {
            newStatus = 'EXECUTED';
          } else if (newExecutedTrays > 0) {
            newStatus = 'PARTIALLY_EXECUTED';
          } else {
            newStatus = 'PLANNED';
          }

          await tx.sowingPlanEntry.update({
            where: { id: planEntryId },
            data: {
              executedTrays: newExecutedTrays,
              status: newStatus,
            },
          });
        }
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

  async findAll(q?: string) {
    const where = q
      ? {
          OR: [
            { variety: { contains: q, mode: 'insensitive' as const } },
            { lotNumber: { contains: q, mode: 'insensitive' as const } },
            { stockType: { contains: q, mode: 'insensitive' as const } },
            { remarks: { contains: q, mode: 'insensitive' as const } },
          ].filter(Boolean),
        }
      : {};

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
      throw new NotFoundException(`SSM Sowing with ID ${id} not found`);
    }

    return sowing;
  }

  async update(id: string, dto: ExecuteSSMDto) {
    const existing = await this.findOne(id);

    const sPerTray = dto.seedsPerTray ?? DEFAULT_SEEDS_PER_TRAY;
    const newQuantity = dto.numberOfTrays * sPerTray;

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
        },
        tx,
      );
      // Reverse old peat (big-ball units)
      const oldPeatUsed = existing.numberOfTrays / 380;
      await this.stockService.addStock(
        {
          lotNumber: 'PEAT',
          productType: 'PEAT',
          stockType: 'GENERIC',
          quantity: oldPeatUsed,
          referenceId: existing.planEntryId ?? existing.id,
          referenceType: ReferenceType.SOWING,
        },
        tx,
      );

      // Apply new stock deduction
      await this.stockService.removeStock(
        {
          lotNumber: dto.lotNumber,
          productType: 'SEEDS',
          stockType: existing.stockType,
          quantity: newQuantity,
          referenceId: existing.planEntryId ?? existing.id,
          referenceType: ReferenceType.SOWING,
        },
        tx,
      );
      // Deduct new peat (big-ball units)
      const newPeatUsed = dto.numberOfTrays / 380;
      await this.stockService.removeStock(
        {
          lotNumber: 'PEAT',
          productType: 'PEAT',
          stockType: 'GENERIC',
          quantity: newPeatUsed,
          referenceId: existing.planEntryId ?? existing.id,
          referenceType: ReferenceType.SOWING,
        },
        tx,
      );

      // Update sowing
      await tx.sowingSSM.update({
        where: { id },
        data: {
          variety: dto.variety,
          sowingDate: dto.sowingDate,
          lotNumber: dto.lotNumber,
          numberOfTrays: dto.numberOfTrays,
          seedsPerTray: sPerTray,
          quantityUsed: newQuantity,
          tunnelId: dto.tunnelId ?? null,
          remarks: dto.remarks,
        },
      });

      // Update plant stock
      const tunnel = dto.tunnelId
        ? await tx.tunnel.findUnique({
            where: { id: dto.tunnelId },
          })
        : null;

      if (existing.plantStock) {
        await tx.plantStock.update({
          where: { id: existing.plantStock.id },
          data: {
            variety: dto.variety,
            location: tunnel?.number ?? existing.plantStock.location,
            lotNumber: dto.lotNumber,
            numberOfTrays: dto.numberOfTrays,
            seedsPerTray: sPerTray,
            expectedPlants: newQuantity,
          },
        });
      }

      return tx.sowingSSM.findUnique({
        where: { id },
        include: { plantStock: true, tunnel: true },
      });
    });
  }

  async remove(id: string) {
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
        },
        tx,
      );
      // Reverse peat (big-ball units)
      const peatToReverse = existing.numberOfTrays / 380;
      await this.stockService.addStock(
        {
          lotNumber: 'PEAT',
          productType: 'PEAT',
          stockType: 'GENERIC',
          quantity: peatToReverse,
          referenceId: existing.planEntryId ?? existing.id,
          referenceType: ReferenceType.SOWING,
        },
        tx,
      );

      // Update plan entry progress (decrement executed count)
      if (existing.planEntryId) {
        const entry = await tx.sowingPlanEntry.findUnique({
          where: { id: existing.planEntryId },
        });

        if (entry) {
          const newExecutedTrays = Math.max(
            0,
            (entry.executedTrays ?? 0) - existing.numberOfTrays,
          );
          const plannedTrays = entry.plannedTrays ?? 0;

          let newStatus: string;
          if (plannedTrays > 0 && newExecutedTrays >= plannedTrays) {
            newStatus = 'EXECUTED';
          } else if (newExecutedTrays > 0) {
            newStatus = 'PARTIALLY_EXECUTED';
          } else {
            newStatus = 'PLANNED';
          }

          await tx.sowingPlanEntry.update({
            where: { id: existing.planEntryId },
            data: {
              executedTrays: newExecutedTrays,
              status: newStatus,
            },
          });
        }
      }

      return tx.sowingSSM.delete({ where: { id } });
    });
  }
}
