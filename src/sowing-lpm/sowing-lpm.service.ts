import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { ReferenceType } from '../stock/enums/reference-type.enum';
import { ExecuteLPMDto } from './dto/execute-lpm.dto';

@Injectable()
export class SowingLPMService {
  constructor(
    private prismaService: PrismaService,
    private stockService: StockService,
  ) {}

  async execute(dto: ExecuteLPMDto) {
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
      metersPerLine,
      seedsPerMeter,
      remarks,
    } = dto;

    let stockType: string;
    let sectorId: string | undefined = dtoSectorId;

    // 1. Validate plan exists
    const plan = await this.prismaService.sowingPlan.findUnique({
      where: { id: planId },
    });

    if (!plan) {
      throw new NotFoundException(`Plan with ID ${planId} not found`);
    }

    if (plan.planType !== 'LPM') {
      throw new BadRequestException(`Plan ${planId} is not an LPM plan`);
    }

    // 2. Validate plan entry if provided — auto-fill from entry
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
      throw new BadRequestException('LPM sowings require lines');
    }
    if (!metersPerLine) {
      throw new BadRequestException('LPM sowings require metersPerLine');
    }

    // 4. Validate sector if sectorId is provided
    let sectorName = '';
    if (sectorId) {
      const sector = await this.prismaService.sector.findUnique({
        where: { id: sectorId },
      });

      if (!sector) {
        throw new NotFoundException(`Sector with ID ${sectorId} not found`);
      }
      sectorName = sector.name;
    }

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
        },
        tx,
      );

      // Create SowingLPM
      const sowing = await tx.sowingLPM.create({
        data: {
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
          metersPerLine,
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
          metersPerLine,
          seedsPerMeter,
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
          const newExecutedQty = (entry.executedQuantity ?? 0) + quantityUsed;
          const plannedQty = entry.plannedQuantity ?? 0;

          let newStatus: string;
          if (plannedQty > 0 && newExecutedQty >= plannedQty) {
            newStatus = 'EXECUTED';
          } else if (newExecutedQty > 0) {
            newStatus = 'PARTIALLY_EXECUTED';
          } else {
            newStatus = 'PLANNED';
          }

          await tx.sowingPlanEntry.update({
            where: { id: planEntryId },
            data: {
              executedQuantity: newExecutedQty,
              status: newStatus,
            },
          });
        }
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

  async findAll(q?: string, planId?: string) {
    const where: any = {};

    if (planId) {
      where.planId = planId;
    }

    if (q) {
      where.OR = [
        { variety: { contains: q, mode: 'insensitive' as const } },
        { lotNumber: { contains: q, mode: 'insensitive' as const } },
        { stockType: { contains: q, mode: 'insensitive' as const } },
        { remarks: { contains: q, mode: 'insensitive' as const } },
        { lines: { contains: q, mode: 'insensitive' as const } },
        { sector: { name: { contains: q, mode: 'insensitive' as const } } },
      ];
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
      throw new NotFoundException(`LPM Sowing with ID ${id} not found`);
    }

    return sowing;
  }

  async update(id: string, dto: ExecuteLPMDto) {
    const existing = await this.findOne(id);

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

      // Apply new stock deduction
      await this.stockService.removeStock(
        {
          lotNumber: dto.lotNumber,
          productType: 'SEEDS',
          stockType: existing.stockType,
          quantity: dto.quantityUsed,
          referenceId: existing.planEntryId ?? existing.id,
          referenceType: ReferenceType.SOWING,
        },
        tx,
      );

      // Update sowing
      await tx.sowingLPM.update({
        where: { id },
        data: {
          variety: dto.variety,
          sowingDate: dto.sowingDate,
          lotNumber: dto.lotNumber,
          quantityUsed: dto.quantityUsed,
          sectorId: dto.sectorId,
          lines: dto.lines,
          metersPerLine: dto.metersPerLine,
          seedsPerMeter: dto.seedsPerMeter,
          remarks: dto.remarks,
        },
      });

      // Update plant stock
      const sector = await tx.sector.findUnique({
        where: { id: dto.sectorId },
      });

      if (existing.plantStock) {
        await tx.plantStock.update({
          where: { id: existing.plantStock.id },
          data: {
            variety: dto.variety,
            location: sector?.name ?? existing.plantStock.location,
            lotNumber: dto.lotNumber,
            lines: dto.lines,
            metersPerLine: dto.metersPerLine,
            seedsPerMeter: dto.seedsPerMeter,
            expectedPlants: dto.quantityUsed,
          },
        });
      }

      return tx.sowingLPM.findUnique({
        where: { id },
        include: { plantStock: true, sector: true },
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

      // Update plan entry progress (decrement executed count)
      if (existing.planEntryId) {
        const entry = await tx.sowingPlanEntry.findUnique({
          where: { id: existing.planEntryId },
        });

        if (entry) {
          const newExecutedQty = Math.max(
            0,
            (entry.executedQuantity ?? 0) - existing.quantityUsed,
          );
          const plannedQty = entry.plannedQuantity ?? 0;

          let newStatus: string;
          if (plannedQty > 0 && newExecutedQty >= plannedQty) {
            newStatus = 'EXECUTED';
          } else if (newExecutedQty > 0) {
            newStatus = 'PARTIALLY_EXECUTED';
          } else {
            newStatus = 'PLANNED';
          }

          await tx.sowingPlanEntry.update({
            where: { id: existing.planEntryId },
            data: {
              executedQuantity: newExecutedQty,
              status: newStatus,
            },
          });
        }
      }

      return tx.sowingLPM.delete({ where: { id } });
    });
  }
}
