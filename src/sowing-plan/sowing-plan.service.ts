import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSowingPlanDto } from './dto/create-sowing-plan.dto';
import { CreatePlanEntryDto } from './dto/create-plan-entry.dto';
import { CreatePlanWithEntriesDto } from './dto/create-plan-with-entries.dto';
import { ImportPlanExcelDto } from './dto/import-plan-excel.dto';
import { PlanType, PlanStatus, PlanEntryStatus } from './enums/plan-type.enum';
import * as XlsxPopulate from 'xlsx-populate';
import { getPaginationParams } from '../common/pagination';
import { ERROR_MESSAGES } from '../common/error-messages';
import { deriveSeedsPerRowMetre } from '../common/sowing.constants';
import { SeasonService } from '../season/season.service';
import {
  FINISHED_ENTRY_STATUSES,
  summarisePlanProgress,
  syncPlanEntryProgress,
} from './plan-entry-progress';
import { StockType } from '../deliveries/enums/stock-type.enum';

@Injectable()
export class SowingPlanService {
  constructor(
    private prismaService: PrismaService,
    private seasonService: SeasonService,
  ) {}

  // ============================================================
  // PLANS
  // ============================================================

  async createPlan(dto: CreateSowingPlanDto) {
    await this.assertPlanNameAvailable(dto.name, dto.location);

    return this.prismaService.sowingPlan.create({
      data: {
        seasonId: this.seasonService.getActiveSeasonId(),
        planType: dto.planType,
        name: dto.name,
        location: dto.location ?? '',
        status: PlanStatus.DRAFT,
      },
    });
  }

  /**
   * A plan name only has to be unique *within a location* — the same
   * "Sector 1" may exist in several locations. The DB composite unique index
   * (+ global exception filter) is the real guard; this gives the user a
   * precise, actionable message up front.
   */
  private async assertPlanNameAvailable(
    name: string,
    location?: string,
  ): Promise<void> {
    const planLocation = location ?? '';
    const existing = await this.prismaService.sowingPlan.findFirst({
      where: { name, location: planLocation },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        planLocation
          ? `A plan named "${name}" already exists in ${planLocation}.`
          : `A plan named "${name}" already exists.`,
      );
    }
  }

  async findAllPlans(q?: string, page?: string, pageSize?: string) {
    const seasonId = this.seasonService.getActiveSeasonId();
    const where = q
      ? {
          seasonId,
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { planType: { contains: q, mode: 'insensitive' as const } },
            { status: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : { seasonId };

    const pagination = getPaginationParams(page, pageSize);

    const plans = await this.prismaService.sowingPlan.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...(pagination ? { skip: pagination.skip, take: pagination.take } : {}),
      // `_count.entries` is not dead code: the plans screen shows it as
      // "N entries". What it was doing here — alongside loading every entry of
      // every plan on the page (SPLAN-08) — was the expensive part.
      include: {
        _count: {
          select: { entries: true },
        },
      },
    });

    // Four numbers per plan, from one grouped query over the plans on this page
    // rather than every entry row. The maths itself lives in one place now, next
    // to the entry rule it belongs to (`summarisePlanProgress`).
    const ids = plans.map((plan) => plan.id);

    const totals =
      ids.length === 0
        ? []
        : await this.prismaService.sowingPlanEntry.groupBy({
            by: ['planId', 'status'],
            where: { planId: { in: ids } },
            _count: { _all: true },
            _sum: {
              plannedTrays: true,
              plannedQuantity: true,
              executedTrays: true,
              executedQuantity: true,
            },
          });

    const withProgress = plans.map((plan) => ({
      ...plan,
      ...summarisePlanProgress(
        plan.planType,
        totals
          .filter((total) => total.planId === plan.id)
          .map((total) => ({
            status: total.status,
            count: total._count._all,
            plannedTrays: total._sum.plannedTrays ?? 0,
            plannedQuantity: total._sum.plannedQuantity ?? 0,
            executedTrays: total._sum.executedTrays ?? 0,
            executedQuantity: total._sum.executedQuantity ?? 0,
          })),
      ),
    }));

    if (pagination) {
      const total = await this.prismaService.sowingPlan.count({ where });
      return {
        items: withProgress,
        total,
        page: pagination.page,
        pageSize: pagination.pageSize,
        hasMore: pagination.page * pagination.pageSize < total,
      };
    }

    return withProgress;
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
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    return plan;
  }

  /**
   * Move a plan between DRAFT, IN_PROGRESS and COMPLETED.
   *
   * This used to accept ANY status the client sent (SPLAN-03): a COMPLETED plan
   * could be put back to DRAFT by anyone holding `sowing.edit`, and a plan could
   * be called COMPLETED while entries were still waiting. The rules now:
   *
   * - DRAFT ⇄ IN_PROGRESS freely — that is starting and stopping work.
   * - → COMPLETED only when every entry is executed or closed, because the
   *   status is what every screen reports as "this plan is done".
   * - COMPLETED → IN_PROGRESS only for an administrator, the same shape as the
   *   closed-season rule: only an administrator goes back on something already
   *   declared finished.
   */
  async updatePlanStatus(id: string, status: PlanStatus, isAdmin: boolean) {
    const plan = await this.findPlanById(id);

    // Already there: nothing to do, and nothing to refuse.
    if (plan.status === status) return plan;

    if (plan.status === PlanStatus.COMPLETED) {
      if (status !== PlanStatus.IN_PROGRESS) {
        throw new BadRequestException(
          'A completed plan can only be reopened to In progress.',
        );
      }

      if (!isAdmin) {
        throw new ForbiddenException(
          'Only an administrator can reopen a completed plan.',
        );
      }

      return this.prismaService.sowingPlan.update({
        where: { id },
        data: { status },
      });
    }

    if (status === PlanStatus.COMPLETED) {
      const unfinished = await this.prismaService.sowingPlanEntry.count({
        where: { planId: id, status: { notIn: FINISHED_ENTRY_STATUSES } },
      });

      if (unfinished > 0) {
        throw new ConflictException(
          unfinished === 1
            ? '1 entry is not finished yet. Execute or close it before completing the plan.'
            : `${unfinished} entries are not finished yet. Execute or close them before completing the plan.`,
        );
      }
    }

    return this.prismaService.sowingPlan.update({
      where: { id },
      data: { status },
    });
  }

  /**
   * Undo a manual close (SPLAN-02).
   *
   * `closeEntry` was a one-way door. That was tolerable while a closed entry
   * could still be sown — but now that executing one is refused, an entry closed
   * by mistake would be unreachable: it cannot be sown, it never appears in the
   * pending list, and nothing could reopen it short of editing the database.
   *
   * The status is not simply restored to a remembered value: the entry goes back
   * to PLANNED and `syncPlanEntryProgress` derives the truth from the sowings
   * that exist — EXECUTED if enough was sown, PARTIALLY_EXECUTED if some was,
   * PLANNED if none. One authority for an entry's status, still.
   */
  async reopenEntry(id: string) {
    const entry = await this.prismaService.sowingPlanEntry.findUnique({
      where: { id },
    });

    if (!entry) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    if (entry.status !== PlanEntryStatus.CLOSED) {
      throw new BadRequestException(
        'Only a closed plan entry can be reopened.',
      );
    }

    return this.prismaService.$transaction(async (tx) => {
      await tx.sowingPlanEntry.update({
        where: { id },
        data: { status: PlanEntryStatus.PLANNED },
      });

      await syncPlanEntryProgress(tx, id);

      return tx.sowingPlanEntry.findUnique({ where: { id } });
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
        if (!entry.plannedQuantity) {
          throw new BadRequestException(
            'Please enter the planned quantity in seeds.',
          );
        }
      }
    }

    await this.assertPlanNameAvailable(dto.name, dto.location);

    return this.prismaService.$transaction(async (tx) => {
      const plan = await tx.sowingPlan.create({
        data: {
          seasonId: this.seasonService.getActiveSeasonId(),
          planType: dto.planType,
          name: dto.name,
          location: dto.location ?? '',
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
            seasonId_location_name: {
              seasonId: this.seasonService.getActiveSeasonId(),
              location: planLocation,
              name: sectorName,
            },
          },
          update: {},
          create: {
            seasonId: this.seasonService.getActiveSeasonId(),
            name: sectorName,
            location: planLocation,
          },
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
            // Derived — never taken from the client, so a plan and the sowing
            // that executes it cannot disagree about the seed rate.
            seedsPerMeter: deriveSeedsPerRowMetre(
              e.plannedQuantity,
              e.lines,
              e.metersPerLine,
            ),
            remark: e.remark,
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
    const planLocation = dto.location ?? '';
    await this.assertPlanNameAvailable(dto.name, planLocation);

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

    // Parse data rows.
    //
    // Deliberately NOT `CreatePlanEntryDto` objects, and deliberately not cast
    // into them (SPLAN-07): this path checks row by row and its messages name the
    // row number, which is what somebody fixing a spreadsheet needs — a DTO
    // message cannot say which line is wrong. The fields both plan types share
    // are listed once, below.
    type ImportedEntry = {
      variety: string;
      stockType: string;
      peat?: string;
      plannedDate: Date;
      plannedTrays?: number;
      plannedQuantity?: number;
      sectorId?: string;
      lines?: number;
      metersPerLine?: number;
      /** Nothing reads a remark column yet; the field is here because the insert
       *  below copies it, and a type that omits it is how that insert stopped
       *  compiling. */
      remark?: string;
    };

    const entries: ImportedEntry[] = [];

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
      const stockTypeRaw = getCell('stocktype') || getCell('stock_type');
      const plannedDateRaw =
        getCell('planneddate') || getCell('planned_date') || getCell('date');

      if (!variety || !stockTypeRaw || !plannedDateRaw) {
        throw new BadRequestException(
          `Row ${i + 1} is missing the variety, stock type or planned date. Please check your Excel file.`,
        );
      }

      // The sheet is the only input on this path and the column is a plain
      // `String`, so a typo like "BIOX" used to be stored as a lot's stock type
      // and nothing downstream could make sense of it. Matched case-insensitively
      // so "bio" and "BIO" both work.
      const stockType = Object.values(StockType).find(
        (value) => value.toUpperCase() === stockTypeRaw.toUpperCase(),
      );

      if (!stockType) {
        throw new BadRequestException(
          `Row ${i + 1}: unknown stock type "${stockTypeRaw}". Use ${Object.values(StockType).join(' or ')}.`,
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
          stockType,
          peat,
          plannedDate,
          plannedTrays,
        });
      } else {
        // LPM
        const sectorName =
          getCell('sectorname') || getCell('sector_name') || getCell('sector');
        const plannedQuantity =
          getCellNum('plannedquantity') ||
          getCellNum('planned_quantity') ||
          getCellNum('quantity');
        // Read as a NUMBER: the column is `Int?`, and this used to hand the raw
        // cell text to Prisma (SPLAN-07).
        const lines = getCellNum('lines');
        const metersPerLine =
          getCellNum('metersperline') || getCellNum('meters_per_line');

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
        // The same two columns `with-entries` insists on, so a plan imported from
        // a sheet and a plan typed in on screen cannot end up needing different
        // inputs.
        if (!lines) {
          throw new BadRequestException(
            `Row ${i + 1}: LPM plan requires lines column`,
          );
        }
        if (!metersPerLine) {
          throw new BadRequestException(
            `Row ${i + 1}: LPM plan requires metersPerLine column`,
          );
        }

        // Strict on purpose, and deliberately unlike `createPlanWithEntries`,
        // which creates a missing sector instead (SPLAN-07): a typed plan is a
        // person choosing a name on screen, where creating it is what they mean;
        // a spreadsheet arrives with whatever was in it, and silently creating
        // sectors from a typo in row 37 fills the season with names nobody chose.
        //
        // Lookup the sector within the plan's location, so the same sector
        // name can exist in several locations without ambiguity.
        const sector = await this.prismaService.sector.findFirst({
          where: planLocation
            ? { name: sectorName, location: planLocation }
            : { name: sectorName },
        });
        if (!sector) {
          throw new BadRequestException(
            planLocation
              ? `Row ${i + 1}: no sector named "${sectorName}" in ${planLocation}.`
              : `Row ${i + 1}: no sector named "${sectorName}".`,
          );
        }

        entries.push({
          variety,
          stockType,
          peat,
          plannedDate,
          plannedQuantity,
          sectorId: sector.id,
          lines,
          metersPerLine,
        });
      }
    }

    if (entries.length === 0) {
      throw new BadRequestException('No valid entries found in Excel file');
    }

    // Create plan + entries in a transaction
    return this.prismaService.$transaction(async (tx) => {
      const plan = await tx.sowingPlan.create({
        data: {
          seasonId: this.seasonService.getActiveSeasonId(),
          planType: dto.planType,
          name: dto.name,
          location: planLocation,
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
          seedsPerMeter: deriveSeedsPerRowMetre(
            e.plannedQuantity,
            e.lines,
            e.metersPerLine,
          ),
          remark: e.remark,
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
        seedsPerMeter: deriveSeedsPerRowMetre(
          dto.plannedQuantity,
          dto.lines,
          dto.metersPerLine,
        ),
        remark: dto.remark,
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
        seedsPerMeter: deriveSeedsPerRowMetre(
          dto.plannedQuantity,
          dto.lines,
          dto.metersPerLine,
        ),
        remark: dto.remark,
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
   * Pending entries, grouped by plan, for the executor's dashboard.
   *
   * Two things were wrong with this (SPLAN-04): it had **no season filter**, so
   * every season's unfinished entries appeared on today's dashboard — including a
   * closed season's — and it was unbounded. Paging is by PLAN rather than by
   * entry: the screen groups entries under their plan, and page 2 should not open
   * with the second half of a plan that started on page 1.
   *
   * No parameters → the same array of groups as before, so neither client changes
   * until it asks for pages (`common/pagination.ts`).
   */
  async findPendingEntries(page?: string, pageSize?: string) {
    // The two states that still want work done on them.
    const pendingEntry = {
      status: {
        in: [PlanEntryStatus.PLANNED, PlanEntryStatus.PARTIALLY_EXECUTED],
      },
    };

    const where = {
      seasonId: this.seasonService.getActiveSeasonId(),
      status: { not: PlanStatus.COMPLETED },
      entries: { some: pendingEntry },
    };

    const pagination = getPaginationParams(page, pageSize);

    const [plans, total] = await Promise.all([
      this.prismaService.sowingPlan.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...(pagination ? { skip: pagination.skip, take: pagination.take } : {}),
        select: {
          id: true,
          name: true,
          planType: true,
          entries: {
            where: pendingEntry,
            orderBy: { plannedDate: 'asc' },
            include: { sector: true },
          },
        },
      }),
      pagination
        ? this.prismaService.sowingPlan.count({ where })
        : Promise.resolve(0),
    ]);

    const groups = plans.map((plan) => ({
      planId: plan.id,
      planName: plan.name,
      planType: plan.planType,
      entries: plan.entries,
    }));

    if (!pagination) return groups;

    return {
      items: groups,
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
      hasMore: pagination.page * pagination.pageSize < total,
    };
  }

  /**
   * Edit an entry's plan.
   *
   * Two things were missing here (SPLAN-01 / SPLAN-06):
   *
   * - The executed counters and the status were never recalculated. `plannedTrays`
   *   is an INPUT to `syncPlanEntryProgress`, so editing it left the entry
   *   claiming a status derived from the old number — and lowering the plan below
   *   what had already been sown left it stuck at PARTIALLY_EXECUTED for ever,
   *   because "fully executed" needs `executed >= planned`.
   * - There was no plan-type branch, though `addEntry` and `addBulkEntries` both
   *   have one. An SSM entry patched with the LPM shape of the body ended up with
   *   `plannedTrays = null`, i.e. `planned = 0`, and could never reach EXECUTED.
   *
   * The write and the re-sync run in one transaction, so the entry is never
   * visible between them.
   */
  async updateEntry(id: string, dto: CreatePlanEntryDto) {
    const entry = await this.prismaService.sowingPlanEntry.findUnique({
      where: { id },
      include: { plan: { select: { planType: true } } },
    });

    if (!entry) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    if (entry.status === PlanEntryStatus.EXECUTED) {
      throw new BadRequestException(
        'Cannot update a fully executed plan entry',
      );
    }

    const isSSM = entry.plan.planType === PlanType.SSM;

    // The same requirements `addEntry` applies: the entry must keep a planned
    // figure its own plan type can compare against.
    if (isSSM && !dto.plannedTrays) {
      throw new BadRequestException('SSM plan entries require plannedTrays');
    }

    if (!isSSM) {
      if (!dto.lines) {
        throw new BadRequestException('LPM plan entries require lines');
      }
      if (!dto.metersPerLine) {
        throw new BadRequestException('LPM plan entries require metersPerLine');
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

    return this.prismaService.$transaction(async (tx) => {
      await tx.sowingPlanEntry.update({
        where: { id },
        data: {
          variety: dto.variety,
          stockType: dto.stockType,
          peat: dto.peat ?? null,
          plannedDate,
          // Only the columns this plan type uses; the other shape is cleared
          // rather than left behind, so a row corrupted by the old behaviour
          // heals when it is next edited.
          plannedTrays: isSSM ? dto.plannedTrays : null,
          plannedQuantity: isSSM ? null : dto.plannedQuantity,
          sectorId: dto.sectorId,
          lines: isSSM ? null : dto.lines,
          metersPerLine: isSSM ? null : dto.metersPerLine,
          seedsPerMeter: isSSM
            ? null
            : deriveSeedsPerRowMetre(
                dto.plannedQuantity,
                dto.lines,
                dto.metersPerLine,
              ),
          remark: dto.remark,
        },
      });

      await syncPlanEntryProgress(tx, id);

      return tx.sowingPlanEntry.findUnique({ where: { id } });
    });
  }

  /**
   * Manually close a plan entry even when fewer trays / quantity were executed
   * than planned (e.g. 145 000 of 150 000).
   *
   * CLOSED is final: syncPlanEntryProgress() skips closed entries, and
   * findPendingEntries() never selects them because it only queries
   * PLANNED / PARTIALLY_EXECUTED.
   */
  async closeEntry(id: string) {
    const entry = await this.prismaService.sowingPlanEntry.findUnique({
      where: { id },
    });

    if (!entry) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    if (entry.status === PlanEntryStatus.EXECUTED) {
      throw new BadRequestException('Plan entry is already fully executed');
    }

    if (entry.status === PlanEntryStatus.CLOSED) {
      return entry;
    }

    return this.prismaService.sowingPlanEntry.update({
      where: { id },
      data: { status: PlanEntryStatus.CLOSED },
    });
  }

  async deleteEntry(id: string) {
    const entry = await this.prismaService.sowingPlanEntry.findUnique({
      where: { id },
    });

    if (!entry) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    if (entry.status === PlanEntryStatus.EXECUTED) {
      throw new BadRequestException(
        'Cannot delete a fully executed plan entry',
      );
    }

    return this.prismaService.sowingPlanEntry.delete({ where: { id } });
  }
}
