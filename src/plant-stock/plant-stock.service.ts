import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ROWS_PER_LINE, toRowMetres } from '../common/sowing.constants';
import { UpdatePlantStockDto } from './dto/update-plant-stock.dto';
import {
  CreatePlantCountDto,
  PlantCountType,
} from './dto/create-plant-count.dto';
import { SeasonService } from '../season/season.service';
import { ERROR_MESSAGES } from '../common/error-messages';
import { getPaginationParams, type Paginated } from '../common/pagination';

/** A count row, as much of it as the summaries read. */
type CountRow = {
  line: number | null;
  germinationRate: number | null;
};

/**
 * What `summariseCounts` returns, and what both clients declare
 * (`Frontend/app/lib/types/plant-stock.ts`, `Phone-App/src/schemas/plant-stock.schema.ts`).
 */
export interface CountSummary {
  /** how many counts went into these figures */
  countCount: number;
  /** average germination %, null when nothing has been counted yet */
  germination: number | null;
  best: number | null;
  worst: number | null;
  /** LPM only — one entry per line that has been counted */
  lines: { line: number; countCount: number; germination: number }[];
}

/**
 * A row as `GET /plant-stock` returns it.
 *
 * An SSM batch is split into one row per tunnel it was transported to; an LPM
 * sowing stays one row, with `location` set to the sector name.
 *
 * Typed instead of `any[]` (PSTOCK-04). The index signature is deliberate: the
 * row is the Prisma `PlantStock` row spread in, plus the derived fields below,
 * and the derived ones are where the drift risk lived — `findOne` and the list
 * each used to build their own copy of them.
 */
export interface PlantStockRow extends Record<string, unknown> {
  id: string;
  variety: string;
  location: string;
  expectedPlants: number;
  numberOfTrays?: number | null;
  seedsSown?: number;
  /** trays actually in the tunnel (SSM only); null when nothing is transported */
  inTunnel: number | null;
  counts: CountRow[];
  countSummary: CountSummary;
  /** plants already harvested from this batch in this location */
  harvested: number;
  /** expectedPlants minus harvested — what is still standing */
  remaining: number;
}

/** The Prisma row plus the relations the row builder reads. */
type PlantStockRelations = {
  id: string;
  variety: string;
  ssmSowingId: string | null;
  lpmSowingId: string | null;
  location: string;
  expectedPlants: number;
  seedsSown: number;
  seedsPerTray: number | null;
  numberOfTrays: number | null;
  counts: CountRow[];
  ssmSowing: {
    tunnelAssignments: {
      numberOfTrays: number;
      tunnelId: string;
      tunnel: { number: string | null } | null;
    }[];
  } | null;
  /** `sectorId` is nullable in the schema — an LPM sowing need not be in a sector. */
  lpmSowing: { sectorId: string | null } | null;
};

/**
 * The identity of one "what is still standing" figure: a batch, in a tunnel
 * (SSM) or in a sector (LPM). The nulls are part of the identity — an SSM batch
 * that has not been transported yet is counted with no tunnel at all, and
 * `HarvestRecord.plantStockId` is nullable in the schema (a harvest whose batch
 * was deleted), so that shape has to be accepted here too.
 */
const harvestKey = (
  plantStockId: string | null,
  tunnelId: string | null,
  sectorId: string | null,
): string => `${plantStockId ?? ''}|${tunnelId ?? ''}|${sectorId ?? ''}`;

@Injectable()
export class PlantStockService {
  constructor(
    private prismaService: PrismaService,
    private seasonService: SeasonService,
  ) {}

  async findAll(
    q?: string,
    stage?: string,
    page?: string,
    pageSize?: string,
  ): Promise<PlantStockRow[] | Paginated<PlantStockRow>> {
    const rows = await this.findAllForSeason(
      this.seasonService.getActiveSeasonId(),
      q,
      stage,
    );

    // Paging is applied to the built ROWS, not to the query (decided
    // 2026-10-01, PSTOCK-02). One SSM batch becomes one row per tunnel it was
    // transported to, so the database hands back batches while the screen shows
    // rows: paging the query would report a `total` that does not match the rows
    // the client is walking through. This bounds the payload, which is the part
    // that grew without limit; the query itself is unchanged.
    //
    // No parameters → a plain array, exactly as before, so neither the web nor
    // the phone changes until it asks for pages (see `common/pagination.ts`).
    const pagination = getPaginationParams(page, pageSize);

    if (!pagination) return rows;

    const start = pagination.skip;
    const items = rows.slice(start, start + pagination.pageSize);

    return {
      items,
      total: rows.length,
      page: pagination.page,
      pageSize: pagination.pageSize,
      hasMore: pagination.page * pagination.pageSize < rows.length,
    };
  }

  /**
   * The same rows, for a NAMED season.
   *
   * The close report needs the season it is about to close, which is not
   * necessarily the open one: an administrator may be browsing another season,
   * and `getActiveSeasonId()` follows that (SEASON-01).
   */
  async findAllForSeason(
    seasonId: string,
    q?: string,
    stage?: string,
  ): Promise<PlantStockRow[]> {
    // PlantStock has no seasonId of its own — it belongs to a sowing, and that
    // is where the season lives. Everything goes into AND so the search box can
    // keep using OR without the two filters interfering.
    const and: Record<string, unknown>[] = [
      { OR: [{ ssmSowing: { seasonId } }, { lpmSowing: { seasonId } }] },
    ];

    if (q) {
      and.push({
        OR: [
          { variety: { contains: q, mode: 'insensitive' as const } },
          { location: { contains: q, mode: 'insensitive' as const } },
          { lotNumber: { contains: q, mode: 'insensitive' as const } },
        ],
      });
    }

    if (stage) {
      and.push({ currentStage: stage });
    }
    const where = { AND: and };
    const items = await this.prismaService.plantStock.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        // ALL counts, not just the latest: the summary averages them.
        counts: { orderBy: { createdAt: 'desc' } },
        ssmSowing: {
          include: { tunnelAssignments: { include: { tunnel: true } } },
        },
        // Needed to key harvests for LPM rows, which are sector-based.
        lpmSowing: { select: { sectorId: true } },
      },
    });

    // Plants already harvested per batch, split by tunnel (SSM) / sector (LPM)
    // so each row can show how much of that batch is still standing.
    //
    // Scoped to the batches in this list (PSTOCK-01). It used to aggregate EVERY
    // harvest of every season and then look each row's figure up by scanning the
    // whole result: the figures were never wrong — `plantStockId` names one
    // batch in one season, so a foreign row could not match — but the entire
    // harvest table was read to answer a question about one screenful.
    const ids = items.map((item) => item.id);
    const harvestTotals =
      ids.length === 0
        ? []
        : await this.prismaService.harvestRecord.groupBy({
            by: ['plantStockId', 'tunnelId', 'sectorId'],
            where: { plantStockId: { in: ids } },
            _sum: { totalPlants: true },
          });

    // One lookup per row, instead of a scan of the whole result per row.
    const harvestedBy = new Map<string, number>();
    for (const total of harvestTotals) {
      harvestedBy.set(
        harvestKey(total.plantStockId, total.tunnelId, total.sectorId),
        total._sum.totalPlants ?? 0,
      );
    }

    const harvestedFor = (
      plantStockId: string,
      tunnelId: string | null,
      sectorId: string | null,
    ) => harvestedBy.get(harvestKey(plantStockId, tunnelId, sectorId)) ?? 0;
    // SSM batches are split per tunnel (tray-transport). Each tunnel gets its own
    // entry with trays, seeds and expected plants proportional to what's in it.
    const rows: PlantStockRow[] = [];
    for (const ps of items) {
      if (ps.ssmSowingId && ps.ssmSowing) {
        const assignments = ps.ssmSowing.tunnelAssignments ?? [];
        if (assignments.length === 0) {
          // not transported yet → planned location, full batch, flagged
          rows.push(this.rowForWholeBatch(ps, harvestedFor(ps.id, null, null)));
        } else {
          for (const a of assignments) {
            const trays = a.numberOfTrays;
            const seedsPerTray = ps.seedsPerTray ?? 0;
            const tunnelNumber = a.tunnel?.number ?? ps.location;
            // Counts are recorded per tunnel — a batch in two tunnels is counted
            // twice and the two figures must not be averaged together.
            const tunnelCounts = ps.counts.filter(
              (c) => c.location === tunnelNumber,
            );
            const expected = trays * seedsPerTray;
            const harvested = harvestedFor(ps.id, a.tunnelId, null);
            rows.push({
              ...ps,
              location: tunnelNumber,
              numberOfTrays: trays,
              seedsSown: expected,
              expectedPlants: expected,
              inTunnel: trays,
              counts: tunnelCounts,
              countSummary: this.summariseCounts(tunnelCounts),
              harvested,
              remaining: expected - harvested,
            });
          }
        }
      } else {
        rows.push(
          this.rowForWholeBatch(
            ps,
            harvestedFor(ps.id, null, ps.lpmSowing?.sectorId ?? null),
          ),
        );
      }
    }

    return rows;
  }

  async findOne(id: string): Promise<PlantStockRow> {
    const plantStock = await this.prismaService.plantStock.findUnique({
      where: { id },
      include: {
        ssmSowing: {
          include: {
            tunnel: true,
            tunnelAssignments: { include: { tunnel: true } },
          },
        },
        lpmSowing: { include: { sector: true } },
        counts: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!plantStock) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    // The batch as a whole, not per tunnel — and built by the same helper the
    // list uses, so the two cannot drift apart (PSTOCK-04).
    return this.rowForWholeBatch(
      plantStock,
      await this.harvestedForBatch(
        plantStock.id,
        plantStock.lpmSowing?.sectorId ?? null,
      ),
    );
  }

  /**
   * The row for a batch taken as a WHOLE rather than per tunnel: what the list
   * shows while nothing has been transported, and what `findOne` returns.
   *
   * The list and `findOne` each used to assemble their own copy of `inTunnel`,
   * `countSummary`, `harvested` and `remaining` — four fields with two owners,
   * which is how two endpoints that disagree about the same figure start
   * (PSTOCK-04).
   */
  private rowForWholeBatch(
    ps: PlantStockRelations,
    harvested: number,
  ): PlantStockRow {
    return {
      ...ps,
      inTunnel: this.computeInTunnel(ps),
      countSummary: this.summariseCounts(ps.counts),
      harvested,
      remaining: ps.expectedPlants - harvested,
    };
  }

  /**
   * Plants harvested from one batch, taken as a whole.
   *
   * The list gets these in one query for every batch on the page; `findOne`
   * asks for its single batch. Both filter on `tunnelId: null` for the SSM case
   * and on the sowing's own sector for LPM, so the two agree.
   */
  private async harvestedForBatch(
    plantStockId: string,
    sectorId: string | null,
  ): Promise<number> {
    const total = await this.prismaService.harvestRecord.aggregate({
      _sum: { totalPlants: true },
      where: { plantStockId, tunnelId: null, sectorId },
    });

    return total._sum.totalPlants ?? 0;
  }

  /**
   * Averages the counts taken on one sowing (SSM: one tunnel, LPM: the whole
   * sowing) and breaks the LPM figures down per line.
   *
   * Lines are averaged individually because they genuinely differ — a line can
   * germinate markedly better or worse than its neighbour, which is the reason
   * for counting per line at all. `best` / `worst` expose that spread.
   *
   * Counts taken more than once on the same line are averaged together.
   */
  private summariseCounts(counts: CountRow[]): CountSummary {
    const rated = counts.filter((c) => c.germinationRate != null);

    if (rated.length === 0) {
      return {
        countCount: counts.length,
        germination: null,
        best: null,
        worst: null,
        lines: [] as {
          line: number;
          countCount: number;
          germination: number;
        }[],
      };
    }

    const mean = (values: number[]) =>
      Number(
        (values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(1),
      );

    const byLine = new Map<number, number[]>();
    for (const c of rated) {
      if (c.line == null) continue;
      const rates = byLine.get(c.line) ?? [];
      rates.push(c.germinationRate as number);
      byLine.set(c.line, rates);
    }

    const lines = [...byLine.entries()]
      .map(([line, rates]) => ({
        line,
        countCount: rates.length,
        germination: mean(rates),
      }))
      .sort((a, b) => a.line - b.line);

    return {
      countCount: counts.length,
      germination: mean(rated.map((c) => c.germinationRate as number)),
      best:
        lines.length > 0 ? Math.max(...lines.map((l) => l.germination)) : null,
      worst:
        lines.length > 0 ? Math.min(...lines.map((l) => l.germination)) : null,
      lines,
    };
  }

  /**
   * What is ACTUALLY in the location (tunnel):
   * sum of the tray-transport assignments for this sowing in that tunnel.
   * (numberOfTrays on the plant stock = whole sowing batch, not what's placed.)
   */
  private computeInTunnel(
    ps: {
      location: string;
      ssmSowing?: {
        tunnelAssignments?: {
          numberOfTrays: number;
          tunnel?: { number: string | null } | null;
        }[];
      } | null;
    } | null,
  ): number | null {
    const assignments = ps?.ssmSowing?.tunnelAssignments;
    if (!assignments || assignments.length === 0) return null;

    const matched = assignments.filter((a) => a.tunnel?.number === ps.location);
    const source = matched.length > 0 ? matched : assignments;

    return source.reduce((sum, a) => sum + a.numberOfTrays, 0);
  }

  async update(id: string, dto: UpdatePlantStockDto) {
    await this.assertExists(id);

    return this.prismaService.plantStock.update({
      where: { id },
      data: dto,
    });
  }

  /**
   * Does the batch exist? Nothing more.
   *
   * `update` used to call `findOne` for this, which loaded the counts, the
   * tunnel assignments and the sector, then built a whole row — to throw all of
   * it away one line later (PSTOCK-04).
   */
  private async assertExists(id: string): Promise<void> {
    const row = await this.prismaService.plantStock.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!row) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }
  }

  /**
   * Trays of one SSM sowing that are actually in a given tunnel.
   *
   * A batch is split across tunnels by tray-transport, and the whole-batch
   * columns on PlantStock (`numberOfTrays`) are never reduced. Extrapolating a
   * count taken in one tunnel over the whole batch would over-report it.
   *
   * Falls back to the whole batch while nothing has been transported yet.
   */
  private traysInLocation(
    ps: {
      numberOfTrays: number | null;
      ssmSowing?: {
        tunnelAssignments?: {
          numberOfTrays: number;
          tunnel?: { number: string | null } | null;
        }[];
      } | null;
    },
    location: string,
  ): number {
    const assignments = ps.ssmSowing?.tunnelAssignments ?? [];
    if (assignments.length === 0) return ps.numberOfTrays ?? 0;

    return assignments
      .filter((a) => a.tunnel?.number === location)
      .reduce((sum, a) => sum + a.numberOfTrays, 0);
  }

  /**
   * Sample-based counting.
   *
   * SSM (TRAY) — whole trays, counted per variety per tunnel:
   *   density     = plants / tray       (sampleSize = trays inspected)
   *   estimated   = density x trays in THAT tunnel
   *   germination = estimated / (trays x seedsPerTray) x 100
   *
   * LPM (ROW_METRE) — 1-metre samples one row at a time, per variety per line:
   *   density     = plants / row-metre  (sampleSize = 1 m samples = row-metres)
   *   estimated   = density x (meterPerLine x ROWS_PER_LINE)
   *   germination = estimated / seedsPerLine x 100
   *
   * Every line of a sowing shares the same length and seed rate, so seedsPerLine
   * is identical across lines and lines are directly comparable — which is the
   * whole point of counting per line.
   *
   * The operator may count the plants present or the gaps; when gaps are given
   * the plants are derived from the seeds expected in the sample.
   */
  async createCount(id: string, dto: CreatePlantCountDto, isAdmin: boolean) {
    const plantStock = await this.prismaService.plantStock.findUnique({
      where: { id },
      include: {
        ssmSowing: {
          include: { tunnelAssignments: { include: { tunnel: true } } },
        },
        // Only for its season — see the check below.
        lpmSowing: { select: { seasonId: true } },
      },
    });

    if (!plantStock) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    // The same rule the interceptor applies to this route, asked again here
    // (PSTOCK-03): a count is evidence about a season that has been reported on,
    // so `SeasonWriteInterceptor` refuses it for everyone but an administrator
    // — who is the only one allowed to correct a closed season.
    // Repeating it means the service is safe on its own — a script, a seed, a
    // future route that forgets the interceptor — instead of relying on the one
    // place that happens to call it today.
    await this.seasonService.assertWritable(
      plantStock.ssmSowing?.seasonId ?? plantStock.lpmSowing?.seasonId,
      isAdmin,
    );

    const plantsGiven = dto.countedPlants !== undefined;
    const gapsGiven = dto.missingPlants !== undefined;
    if (plantsGiven === gapsGiven) {
      throw new BadRequestException(
        'Enter either the plants you counted or the gaps you found, not both.',
      );
    }

    const isTray = dto.countType === PlantCountType.TRAY;

    // What the extrapolation is measured against: the trays of the tunnel that
    // was counted (SSM), or the row-metres of a single line (LPM).
    let location: string;
    let line: number | null = null;
    let rowsInspected: number | null = null;
    let expectedInSample: number;
    let scopeSize: number;
    let seedsInScope: number;

    if (isTray) {
      if (dto.line !== undefined || dto.rowsInspected !== undefined) {
        throw new BadRequestException(
          'Lines and rows only apply to field (LPM) sowings.',
        );
      }
      const tunnel = dto.location?.trim();
      if (!tunnel) {
        throw new BadRequestException('Select the tunnel you counted.');
      }
      const seedsPerTray = plantStock.seedsPerTray ?? 0;
      if (seedsPerTray <= 0) {
        throw new BadRequestException(
          'This sowing has no seeds per tray, so it cannot be counted.',
        );
      }
      const trays = this.traysInLocation(plantStock, tunnel);
      if (trays <= 0) {
        throw new BadRequestException(
          `No trays of this sowing are in ${tunnel}.`,
        );
      }
      location = tunnel;
      expectedInSample = dto.sampleSize * seedsPerTray;
      scopeSize = trays;
      seedsInScope = trays * seedsPerTray;
    } else {
      const lines = plantStock.lines ?? 0;
      const metresPerLine = plantStock.meterPerLine ?? 0;
      const seedsPerMeter = plantStock.seedsPerMeter ?? 0;
      if (lines <= 0 || metresPerLine <= 0 || seedsPerMeter <= 0) {
        throw new BadRequestException(
          'This sowing is missing its lines, line length or seeds per metre, so it cannot be counted.',
        );
      }
      if (dto.line === undefined) {
        throw new BadRequestException('Select the line you counted.');
      }
      if (dto.line > lines) {
        throw new BadRequestException(
          `This sowing only has ${lines} ${lines === 1 ? 'line' : 'lines'}.`,
        );
      }
      if (
        dto.rowsInspected !== undefined &&
        dto.rowsInspected > dto.sampleSize
      ) {
        throw new BadRequestException(
          'You need at least one sample for each row you inspected.',
        );
      }
      const seedsSown = plantStock.seedsSown || 0;
      if (seedsSown <= 0) {
        throw new BadRequestException(
          'This sowing has no seed quantity recorded, so it cannot be counted.',
        );
      }
      location = plantStock.location;
      line = dto.line;
      rowsInspected = dto.rowsInspected ?? ROWS_PER_LINE;
      expectedInSample = dto.sampleSize * seedsPerMeter;
      // A single line, all of its rows.
      scopeSize = toRowMetres(1, metresPerLine);
      // Exact: the seeds actually sown divided by the lines sown. Using the
      // stored `seedsPerMeter` here would inherit its integer rounding.
      seedsInScope = seedsSown / lines;
    }

    const countedPlants =
      dto.countedPlants ??
      Math.round(expectedInSample) - (dto.missingPlants ?? 0);

    if (countedPlants < 0) {
      throw new BadRequestException(
        'You counted more gaps than there are seeds in the sample.',
      );
    }

    const density = countedPlants / dto.sampleSize;
    const estimatedPlants = Math.round(density * scopeSize);
    const germinationRate =
      seedsInScope > 0
        ? Number(((estimatedPlants / seedsInScope) * 100).toFixed(1))
        : null;

    return this.prismaService.plantCount.create({
      data: {
        plantStockId: id,
        countType: dto.countType,
        location,
        line,
        rowsInspected,
        sampleSize: dto.sampleSize,
        countedPlants,
        missingPlants: dto.missingPlants ?? null,
        density: Number(density.toFixed(4)),
        estimatedPlants,
        germinationRate,
        notes: dto.notes ?? null,
      },
    });
  }
}
