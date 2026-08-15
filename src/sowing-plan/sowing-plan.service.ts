import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSowingPlanDto } from './dto/create-sowing-plan.dto';
import { CreatePlanEntryDto } from './dto/create-plan-entry.dto';
import { CreatePlanWithEntriesDto } from './dto/create-plan-with-entries.dto';
import { ImportPlanExcelDto } from './dto/import-plan-excel.dto';
import { PlanType, PlanStatus, PlanEntryStatus } from './enums/plan-type.enum';
import * as XlsxPopulate from 'xlsx-populate';

@Injectable()
export class SowingPlanService {
  constructor(private prismaService: PrismaService) {}

  // ============================================================
  // PLANS
  // ============================================================

  async createPlan(dto: CreateSowingPlanDto) {
    return this.prismaService.sowingPlan.create({
      data: {
        planType: dto.planType,
        name: dto.name,
        status: PlanStatus.DRAFT,
      },
    });
  }

  async findAllPlans(q?: string) {
    const where = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { planType: { contains: q, mode: 'insensitive' as const } },
            { status: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const plans = await this.prismaService.sowingPlan.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { entries: true },
        },
        entries: {
          select: {
            status: true,
            plannedTrays: true,
            plannedQuantity: true,
            executedTrays: true,
            executedQuantity: true,
          },
        },
      },
    });

    // Compute progress percentage based on quantities (not entry count)
    return plans.map((plan) => {
      const { entries, ...rest } = plan;

      let plannedTotal = 0;
      let executedTotal = 0;

      for (const e of entries) {
        if (plan.planType === 'SSM') {
          plannedTotal += e.plannedTrays ?? 0;
          executedTotal += e.executedTrays ?? 0;
        } else {
          plannedTotal += e.plannedQuantity ?? 0;
          executedTotal += e.executedQuantity ?? 0;
        }
      }

      const progressPercent =
        plannedTotal > 0 ? Math.round((executedTotal / plannedTotal) * 100) : 0;

      const executedEntryCount = entries.filter(
        (e) => e.status === 'EXECUTED',
      ).length;

      return {
        ...rest,
        executedCount: executedEntryCount,
        plannedTotal,
        executedTotal,
        progressPercent,
      };
    });
  }

  async findPlanById(id: string) {
    const plan = await this.prismaService.sowingPlan.findUnique({
      where: { id },
      include: {
        entries: {
          orderBy: { plannedDate: 'asc' },
          include: {
            sector: true,
            ssmSowings: {
              include: {
                plantStock: true,
                tunnel: true,
                tunnelAssignments: { include: { tunnel: true } },
              },
            },
            lpmSowings: { include: { plantStock: true, sector: true } },
          },
        },
      },
    });

    if (!plan) {
      throw new NotFoundException(`Plan with ID ${id} not found`);
    }

    return plan;
  }

  async updatePlanStatus(id: string, status: PlanStatus) {
    await this.findPlanById(id);
    return this.prismaService.sowingPlan.update({
      where: { id },
      data: { status },
    });
  }

  async deletePlan(id: string) {
    await this.findPlanById(id);
    return this.prismaService.sowingPlan.delete({ where: { id } });
  }

  /**
   * Atomically create a plan AND its entries in a single transaction.
   * Either everything succeeds, or nothing is persisted.
   */
  async createPlanWithEntries(dto: CreatePlanWithEntriesDto) {
    // Validate entries before starting the transaction
    if (!dto.entries || dto.entries.length === 0) {
      throw new BadRequestException('At least one entry is required');
    }

    for (const entry of dto.entries) {
      if (dto.planType === PlanType.SSM && !entry.plannedTrays) {
        throw new BadRequestException('SSM plan entries require plannedTrays');
      }
    }

    if (dto.planType === PlanType.LPM) {
      if (!dto.location) {
        throw new BadRequestException('LPM plan requires a location');
      }
      for (const entry of dto.entries) {
        if (!entry.lines) {
          throw new BadRequestException('LPM plan entries require lines');
        }
        if (!entry.metersPerLine) {
          throw new BadRequestException(
            'LPM plan entries require metersPerLine',
          );
        }
        if (!entry.seedsPerMeter) {
          throw new BadRequestException(
            'LPM plan entries require seedsPerMeter',
          );
        }
        if (!entry.plannedQuantity) {
          throw new BadRequestException(
            'LPM plan entries require plannedQuantity (auto-calculated from Lines × M/L × S/M × 7)',
          );
        }
      }
    }

    return this.prismaService.$transaction(async (tx) => {
      const plan = await tx.sowingPlan.create({
        data: {
          planType: dto.planType,
          name: dto.name,
          location: dto.location,
          status: PlanStatus.DRAFT,
        },
      });

      // Resolve the LPM sector ONCE for the whole plan (not per entry) so that
      // concurrent entries can't race each other on the (location, name) unique key.
      const sectorName =
        dto.planType === PlanType.LPM
          ? dto.sectorId || dto.name.match(/\d+/)?.[0] || dto.name
          : null;
      const planLocation = dto.location;

      let autoSectorId: string | undefined;
      if (dto.planType === PlanType.LPM && planLocation && sectorName) {
        const sector = await tx.sector.upsert({
          where: {
            location_name: { location: planLocation, name: sectorName },
          },
          update: {},
          create: { name: sectorName, location: planLocation },
        });
        autoSectorId = sector.id;
      }

      const entriesData = await Promise.all(
        dto.entries.map(async (e) => {
          // Per-entry sector wins; otherwise fall back to the plan-level auto sector.
          const sectorId = e.sectorId || autoSectorId;

          return {
            planId: plan.id,
            variety: e.variety,
            stockType: e.stockType,
            peat: e.peat ?? null,
            plannedDate:
              e.plannedDate instanceof Date
                ? e.plannedDate
                : new Date(e.plannedDate),
            plannedTrays: e.plannedTrays,
            plannedQuantity: e.plannedQuantity,
            sectorId,
            lines: e.lines,
            metersPerLine: e.metersPerLine,
            seedsPerMeter: e.seedsPerMeter,
          };
        }),
      );

      await tx.sowingPlanEntry.createMany({ data: entriesData });

      return tx.sowingPlan.findUnique({
        where: { id: plan.id },
        include: {
          _count: { select: { entries: true } },
          entries: { orderBy: { plannedDate: 'asc' } },
        },
      });
    });
  }

  // ============================================================
  // EXCEL IMPORT
  // ============================================================

  /**
   * Import a sowing plan from an Excel file (base64).
   *
   * Expected Excel columns (header row):
   *   variety, stockType, plannedDate
   *   SSM extras: plannedTrays
   *   LPM extras: plannedQuantity, sectorName, lines, metersPerLine, seedsPerMeter
   *   Optional: peat (SSM only — trail details, e.g. "50% CVT 50% BIO")
   *
   * Date format: YYYY-MM-DD or DD/MM/YYYY
   */
  async importFromExcel(dto: ImportPlanExcelDto) {
    // Decode base64 to buffer
    const buffer = Buffer.from(dto.excelBase64, 'base64');

    // Parse Excel
    const workbook = await XlsxPopulate.fromDataAsync(buffer as any);
    const sheet = workbook.sheet(0);
    if (!sheet) {
      throw new BadRequestException('Excel file has no sheets');
    }

    const usedRange = sheet.usedRange();
    if (!usedRange) {
      throw new BadRequestException('Excel sheet is empty');
    }

    const rows = usedRange.value() as unknown[][];
    if (rows.length < 2) {
      throw new BadRequestException(
        'Excel file must have a header row and at least one data row',
      );
    }

    // Parse header row (case-insensitive)
    const headers = (rows[0] as string[]).map((h) =>
      String(h).trim().toLowerCase(),
    );

    // Parse data rows
    const entries: CreatePlanEntryDto[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (
        !row ||
        row.every(
          (cell) =>
            cell === undefined || cell === null || String(cell).trim() === '',
        )
      ) {
        continue; // skip empty rows
      }

      const getCell = (colName: string): string => {
        const idx = headers.indexOf(colName.toLowerCase());
        if (idx === -1) return '';
        const val = row[idx];
        return val === undefined || val === null ? '' : String(val).trim();
      };

      const getCellNum = (colName: string): number | undefined => {
        const val = getCell(colName);
        if (!val) return undefined;
        const num = Number(val);
        return isNaN(num) ? undefined : num;
      };

      const variety = getCell('variety');
      const stockType = getCell('stocktype') || getCell('stock_type');
      const plannedDateRaw =
        getCell('planneddate') || getCell('planned_date') || getCell('date');

      if (!variety || !stockType || !plannedDateRaw) {
        throw new BadRequestException(
          `Row ${i + 1}: missing required field(s). Required: variety, stockType, plannedDate`,
        );
      }

      // Peat value (text, SSM only)
      const peat = getCell('peat') || undefined;

      // Parse date (support YYYY-MM-DD and DD/MM/YYYY)
      let plannedDate: Date;
      if (/^\d{4}-\d{2}-\d{2}$/.test(plannedDateRaw)) {
        plannedDate = new Date(plannedDateRaw);
      } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(plannedDateRaw)) {
        const [d, m, y] = plannedDateRaw.split('/');
        plannedDate = new Date(Number(y), Number(m) - 1, Number(d));
      } else {
        // Try parsing Excel serial date number
        const serial = Number(plannedDateRaw);
        if (!isNaN(serial) && serial > 30000) {
          // Excel date serial: days since 1900-01-01 (with the 1900 leap year bug)
          plannedDate = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
        } else {
          plannedDate = new Date(plannedDateRaw);
        }
      }

      if (isNaN(plannedDate.getTime())) {
        throw new BadRequestException(
          `Row ${i + 1}: invalid date "${plannedDateRaw}". Use YYYY-MM-DD or DD/MM/YYYY format.`,
        );
      }

      if (dto.planType === PlanType.SSM) {
        const plannedTrays =
          getCellNum('plannedtrays') ||
          getCellNum('planned_trays') ||
          getCellNum('trays');

        if (!plannedTrays) {
          throw new BadRequestException(
            `Row ${i + 1}: SSM plan requires plannedTrays column`,
          );
        }

        entries.push({
          variety,
          stockType: stockType as any,
          peat,
          plannedDate,
          plannedTrays,
        } as CreatePlanEntryDto);
      } else {
        // LPM
        const sectorName =
          getCell('sectorname') || getCell('sector_name') || getCell('sector');
        const plannedQuantity =
          getCellNum('plannedquantity') ||
          getCellNum('planned_quantity') ||
          getCellNum('quantity');
        const lines = getCell('lines');
        const metersPerLine =
          getCellNum('metersperline') || getCellNum('meters_per_line');
        const seedsPerMeter =
          getCellNum('seedspermeter') || getCellNum('seeds_per_meter');

        if (!sectorName) {
          throw new BadRequestException(
            `Row ${i + 1}: LPM plan requires sectorName column`,
          );
        }
        if (!plannedQuantity) {
          throw new BadRequestException(
            `Row ${i + 1}: LPM plan requires plannedQuantity column`,
          );
        }

        // Lookup sector by name
        const sector = await this.prismaService.sector.findFirst({
          where: { name: sectorName },
        });
        if (!sector) {
          throw new BadRequestException(
            `Row ${i + 1}: sector "${sectorName}" not found`,
          );
        }

        entries.push({
          variety,
          stockType: stockType as any,
          peat,
          plannedDate,
          plannedQuantity,
          sectorId: sector.id,
          lines: lines || undefined,
          metersPerLine,
          seedsPerMeter,
        } as CreatePlanEntryDto);
      }
    }

    if (entries.length === 0) {
      throw new BadRequestException('No valid entries found in Excel file');
    }

    // Create plan + entries in a transaction
    return this.prismaService.$transaction(async (tx) => {
      const plan = await tx.sowingPlan.create({
        data: {
          planType: dto.planType,
          name: dto.name,
          status: PlanStatus.DRAFT,
        },
      });

      await tx.sowingPlanEntry.createMany({
        data: entries.map((e) => ({
          planId: plan.id,
          variety: e.variety,
          stockType: e.stockType,
          peat: e.peat ?? null,
          plannedDate: e.plannedDate,
          plannedTrays: e.plannedTrays,
          plannedQuantity: e.plannedQuantity,
          sectorId: e.sectorId,
          lines: e.lines,
          metersPerLine: e.metersPerLine,
          seedsPerMeter: e.seedsPerMeter,
        })),
      });

      return tx.sowingPlan.findUnique({
        where: { id: plan.id },
        include: {
          _count: { select: { entries: true } },
          entries: { orderBy: { plannedDate: 'asc' } },
        },
      });
    });
  }

  // ============================================================
  // ENTRIES
  // ============================================================

  async addEntry(planId: string, dto: CreatePlanEntryDto) {
    const plan = await this.findPlanById(planId);

    // Validate that SSM plans have SSM fields and LPM plans have LPM fields
    if (plan.planType === PlanType.SSM) {
      if (!dto.plannedTrays) {
        throw new BadRequestException('SSM plan entries require plannedTrays');
      }
    }

    if (plan.planType === PlanType.LPM) {
      if (!dto.lines) {
        throw new BadRequestException('LPM plan entries require lines');
      }
      if (!dto.metersPerLine) {
        throw new BadRequestException('LPM plan entries require metersPerLine');
      }
      if (!dto.seedsPerMeter) {
        throw new BadRequestException('LPM plan entries require seedsPerMeter');
      }
      if (!dto.plannedQuantity) {
        throw new BadRequestException(
          'LPM plan entries require plannedQuantity',
        );
      }
    }

    const plannedDate =
      dto.plannedDate instanceof Date
        ? dto.plannedDate
        : new Date(dto.plannedDate);

    return this.prismaService.sowingPlanEntry.create({
      data: {
        planId,
        variety: dto.variety,
        stockType: dto.stockType,
        peat: dto.peat ?? null,
        plannedDate,
        plannedTrays: dto.plannedTrays,
        plannedQuantity: dto.plannedQuantity,
        sectorId: dto.sectorId,
        lines: dto.lines,
        metersPerLine: dto.metersPerLine,
        seedsPerMeter: dto.seedsPerMeter,
      },
    });
  }

  async addBulkEntries(planId: string, dtos: CreatePlanEntryDto[]) {
    const plan = await this.findPlanById(planId);

    const data = dtos.map((dto) => {
      if (plan.planType === PlanType.SSM) {
        if (!dto.plannedTrays) {
          throw new BadRequestException(
            'SSM plan entries require plannedTrays',
          );
        }
      }
      if (plan.planType === PlanType.LPM) {
        if (!dto.lines) {
          throw new BadRequestException('LPM plan entries require lines');
        }
        if (!dto.metersPerLine) {
          throw new BadRequestException(
            'LPM plan entries require metersPerLine',
          );
        }
        if (!dto.seedsPerMeter) {
          throw new BadRequestException(
            'LPM plan entries require seedsPerMeter',
          );
        }
        if (!dto.plannedQuantity) {
          throw new BadRequestException(
            'LPM plan entries require plannedQuantity',
          );
        }
      }

      const plannedDate =
        dto.plannedDate instanceof Date
          ? dto.plannedDate
          : new Date(dto.plannedDate);

      return {
        planId,
        variety: dto.variety,
        stockType: dto.stockType,
        peat: dto.peat ?? null,
        plannedDate,
        plannedTrays: dto.plannedTrays,
        plannedQuantity: dto.plannedQuantity,
        sectorId: dto.sectorId,
        lines: dto.lines,
        metersPerLine: dto.metersPerLine,
        seedsPerMeter: dto.seedsPerMeter,
      };
    });

    return this.prismaService.sowingPlanEntry.createMany({ data });
  }

  async findPlanEntries(planId: string) {
    await this.findPlanById(planId);
    return this.prismaService.sowingPlanEntry.findMany({
      where: { planId },
      orderBy: { plannedDate: 'asc' },
      include: {
        sector: true,
        ssmSowings: { include: { plantStock: true } },
        lpmSowings: { include: { plantStock: true } },
      },
    });
  }

  /**
   * Returns all PLANNED entries grouped by plan, for the executor's dashboard.
   * Only returns entries from plans whose status is not COMPLETED.
   */
  async findPendingEntries() {
    const entries = await this.prismaService.sowingPlanEntry.findMany({
      where: {
        status: {
          in: [PlanEntryStatus.PLANNED, PlanEntryStatus.PARTIALLY_EXECUTED],
        },
        plan: { status: { not: PlanStatus.COMPLETED } },
      },
      orderBy: { plannedDate: 'asc' },
      include: {
        plan: { select: { id: true, name: true, planType: true } },
        sector: true,
      },
    });

    // Group by plan
    const grouped: Record<
      string,
      {
        planId: string;
        planName: string;
        planType: string;
        entries: typeof entries;
      }
    > = {};

    for (const e of entries) {
      if (!grouped[e.planId]) {
        grouped[e.planId] = {
          planId: e.planId,
          planName: e.plan.name,
          planType: e.plan.planType,
          entries: [],
        };
      }
      grouped[e.planId].entries.push(e);
    }

    // Return as array of groups
    return Object.values(grouped);
  }

  async updateEntry(id: string, dto: CreatePlanEntryDto) {
    const entry = await this.prismaService.sowingPlanEntry.findUnique({
      where: { id },
    });

    if (!entry) {
      throw new NotFoundException(`Plan entry with ID ${id} not found`);
    }

    if (entry.status === 'EXECUTED') {
      throw new BadRequestException(
        'Cannot update a fully executed plan entry',
      );
    }

    const plannedDate =
      dto.plannedDate instanceof Date
        ? dto.plannedDate
        : new Date(dto.plannedDate);

    return this.prismaService.sowingPlanEntry.update({
      where: { id },
      data: {
        variety: dto.variety,
        stockType: dto.stockType,
        peat: dto.peat ?? null,
        plannedDate,
        plannedTrays: dto.plannedTrays,
        plannedQuantity: dto.plannedQuantity,
        sectorId: dto.sectorId,
        lines: dto.lines,
        metersPerLine: dto.metersPerLine,
        seedsPerMeter: dto.seedsPerMeter,
      },
    });
  }

  async deleteEntry(id: string) {
    const entry = await this.prismaService.sowingPlanEntry.findUnique({
      where: { id },
    });

    if (!entry) {
      throw new NotFoundException(`Plan entry with ID ${id} not found`);
    }

    if (entry.status === 'EXECUTED') {
      throw new BadRequestException(
        'Cannot delete a fully executed plan entry',
      );
    }

    return this.prismaService.sowingPlanEntry.delete({ where: { id } });
  }
}
