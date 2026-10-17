import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UNASSIGNED_LOCATION, toRowMetres } from '../common/sowing.constants';
import { predictedPlantsForTrays } from '../common/harvest-expectation';
import { UpdatePlantStockDto } from './dto/update-plant-stock.dto';
import { isPlantStage, notAPlantStage } from './plant-stock.constants';
import { compareLocations } from './plant-stock.constants';
import {
  PlantCountSampleDto,
  PlantCountType,
  SavePlantCountDto,
} from './dto/save-plant-count.dto';
import { SeasonService } from '../season/season.service';
import { ERROR_MESSAGES } from '../common/error-messages';
import { getPaginationParams, type Paginated } from '../common/pagination';

/**
 * A count row, as much of it as the summaries read.
 *
 * `samples` says how many readings the count holds and which lines they came from
 * (PSTOCK-24): the per-line figures are pooled by them, so a reading of ten trays
 * weighs more than one of two. Empty for a count recorded before readings existed
 * — that one weighs once, on the line it names.
 */
type CountRow = {
  line: number | null;
  germinationRate: number | null;
  /** 'TRAY' (SSM) | 'ROW_METRE' (LPM) — how the count was taken. */
  countType: string;
  /**
   * Where it was taken: a tunnel number for trays, the sector the batch was
   * sown in for a field. `summariseCounts` never reads it, but the field figure
   * does — it is how a batch finds its own counts.
   */
  location: string | null;
  /** Extrapolated to that count's scope: one tunnel, or one LINE (HARV-08). */
  estimatedPlants: number;
  /** When it was taken — the newest is the one that counts. */
  countDate: Date;
  samples?: { line: number | null }[];
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
  /**
   * LPM only — one entry per line that has been counted.
   *
   * `isBest` is decided HERE (PSTOCK-19). The web used to work it out again with
   * a `reduce` over these same numbers while printing the server's `best` right
   * beside it, so the star and the figure could one day name different lines —
   * and the phone had no star at all, because a rule that lives in a screen only
   * exists in that screen. A tie marks every line that holds it: "these two are
   * both the best" is true, an arbitrary pick of one is not.
   */
  lines: {
    line: number;
    countCount: number;
    germination: number;
    isBest: boolean;
  }[];
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
  /**
   * The plants a COUNT measured standing here, or null when nothing has been
   * counted (HARV-08).
   *
   * Only a field (sector) carries one so far: a tunnel row is still built from
   * the forecast, and for SSM `expectedPlants` is a plants figure anyway.
   */
  countedPlants?: number | null;
  /**
   * What is still standing.
   *
   * NULL for a field that has not been counted (HARV-08): its `expectedPlants`
   * is the SEED count, so subtracting plants from it compares two different
   * things. The screens show "not counted" rather than a number nobody can
   * stand behind.
   */
  remaining: number | null;
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
  /** LPM only — the lines the field was sown with; the field figure needs it. */
  lines: number | null;
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

/**
 * One reading, as this service reads it back (PSTOCK-24).
 *
 * `position` is the order it was typed in — part of the row, not just something
 * the save call adds, because a count reads back exactly as it was entered.
 */
type CountSampleRow = {
  line: number | null;
  countedPlants: number;
  missingPlants: number | null;
  position: number;
};

/**
 * What a count's figures are measured against — stored on the count itself, so
 * that adding readings later (PSTOCK-24) re-does the arithmetic on the SAME basis
 * instead of on whatever the tunnel happens to hold that day.
 */
type CountBasis = { scopeSize: number; seedsInScope: number };

/**
 * The batch's own counting facts — the part that does not depend on where the
 * trays are today, so an append can use it without re-reading the tunnel.
 */
type BatchFacts = {
  isTray: boolean;
  /** LPM: how many lines the sowing has. Null for trays. */
  lines: number | null;
  /** Seeds ONE sample was sown with: a tray's seeds, or one row-metre's. */
  seedsPerSample: number;
};

/**
 * The count's figures, worked out from its readings — ONE place (PSTOCK-24).
 *
 * Every reading is the same size (one tray, or one metre of one row), so the mean
 * of the readings and their total divided by their number are the same figure; the
 * mean is the one an eye does when it looks down ten numbers.
 *
 * `line` comes out as the single line the readings share, or null when the
 * session walked more than one — a count is a SESSION, not a line. The per-line
 * figures are built from the readings themselves (`summariseCounts`).
 */
function summariseSamples(
  samples: CountSampleRow[],
  basis: CountBasis,
): {
  sampleSize: number;
  countedPlants: number;
  missingPlants: number | null;
  density: number;
  estimatedPlants: number;
  germinationRate: number | null;
  line: number | null;
} {
  const sampleSize = samples.length;
  const countedPlants = samples.reduce((sum, s) => sum + s.countedPlants, 0);
  const gaps = samples.reduce((sum, s) => sum + (s.missingPlants ?? 0), 0);
  const anyGaps = samples.some((s) => s.missingPlants != null);

  const density = sampleSize > 0 ? countedPlants / sampleSize : 0;
  const estimatedPlants = Math.round(density * basis.scopeSize);
  const germinationRate =
    basis.seedsInScope > 0
      ? Number(((estimatedPlants / basis.seedsInScope) * 100).toFixed(1))
      : null;

  const lines = [
    ...new Set(
      samples.map((s) => s.line).filter((l): l is number => l != null),
    ),
  ];

  return {
    sampleSize,
    countedPlants,
    // Null when every reading was entered as plants, as before (PSTOCK-24).
    missingPlants: anyGaps ? gaps : null,
    density: Number(density.toFixed(4)),
    estimatedPlants,
    germinationRate,
    line: lines.length === 1 ? lines[0] : null,
  };
}

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
          /**
           * The tunnels the batch was actually SENT to (PSTOCK-09).
           *
           * An SSM batch split over several tunnels is one row per tunnel, but
           * `PlantStock.location` holds only one of them — the latest transport
           * (TRAY-06/07) — so searching "T2" missed a batch standing in T2 and
           * T3. `location` is still searched above, because it is the only thing
           * that can find a batch BEFORE its trays are transported: then there
           * are no assignments at all, just the planned tunnel.
           *
           * A batch found this way comes back with ALL of its rows, including
           * the tunnels the search did not name — the batch is one thing, and
           * seeing where else it stands is part of the answer.
           */
          {
            ssmSowing: {
              tunnelAssignments: {
                some: {
                  tunnel: {
                    number: { contains: q, mode: 'insensitive' as const },
                  },
                },
              },
            },
          },
        ],
      });
    }

    if (stage) {
      // A stage we do not have is refused, not answered with an empty list
      // (PSTOCK-05, decided 2026-10-08). The column is a free string, so this is
      // the only place that can catch a typo — and a typo used to look exactly
      // like "this season has nothing in it".
      if (!isPlantStage(stage)) {
        throw new BadRequestException(notAPlantStage(stage));
      }

      and.push({ currentStage: stage });
    }
    const where = { AND: and };
    const items = await this.prismaService.plantStock.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        // ALL counts, not just the latest: the summary averages them. Their
        // readings come too — the per-line figures are pooled by them, and the
        // screens show the spread (PSTOCK-24).
        counts: {
          orderBy: { createdAt: 'desc' },
          include: { samples: { orderBy: { position: 'asc' } } },
        },
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
            // What those trays were SOWN with, and, separately, what they are
            // expected to yield. The two are the same number whenever the batch
            // recorded a seeds-per-tray. When it did not, the seed figure is
            // genuinely unknown (0) but the expectation still has to be a real
            // number — this used to multiply by 0, so the row showed an
            // "expected" of nothing and a NEGATIVE remaining (HARV-07).
            const seedsSown = trays * seedsPerTray;
            const expected = predictedPlantsForTrays(ps, trays);
            const harvested = harvestedFor(ps.id, a.tunnelId, null);
            rows.push({
              ...ps,
              location: tunnelNumber,
              numberOfTrays: trays,
              seedsSown,
              expectedPlants: expected,
              inTunnel: trays,
              counts: tunnelCounts,
              countSummary: this.summariseCounts(tunnelCounts),
              harvested,
              remaining: expected - harvested,
            });
          }

          /**
           * The trays that have NOT been transported yet (PSTOCK-22).
           *
           * A batch used to be described ONLY by its transports the moment the
           * first tray left: sow 2000 trays, send 500 to a tunnel, and the other
           * 1500 vanished — no row, no location, and the "initial stock" figures
           * dropped by their share. They are real plants standing in the nursery,
           * so they get their own row, under `UNASSIGNED_LOCATION`: not "the
           * tunnel this batch is planned for", but *not in a tunnel*, which is
           * where they actually are.
           *
           * Counts and harvests are empty by construction: a sample is always
           * taken in a tunnel (`saveCount` refuses otherwise) and a harvest
           * names the tunnel or sector it came from.
           */
          const assignedTrays = assignments.reduce(
            (sum, a) => sum + a.numberOfTrays,
            0,
          );
          const waitingTrays = (ps.numberOfTrays ?? 0) - assignedTrays;

          if (waitingTrays > 0) {
            const seedsPerTray = ps.seedsPerTray ?? 0;
            // Same split as the per-tunnel rows above: seeds sown is what is
            // known, the expectation comes from the shared helper so it never
            // collapses to nothing on a batch with no seeds-per-tray (HARV-07).
            const seedsSown = waitingTrays * seedsPerTray;
            const expected = predictedPlantsForTrays(ps, waitingTrays);
            const harvested = harvestedFor(ps.id, null, null);
            rows.push({
              ...ps,
              location: UNASSIGNED_LOCATION,
              numberOfTrays: waitingTrays,
              seedsSown,
              expectedPlants: expected,
              // The one figure that means "trays standing in a tunnel", so it
              // stays empty — this row is exactly the trays that are not.
              inTunnel: null,
              counts: [],
              countSummary: this.summariseCounts([]),
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

    // One display order, decided here rather than twice on the clients
    // (PSTOCK-18): the screens group these rows by location, so this order is
    // the order of the tunnel/sector table. See `compareLocations`.
    rows.sort((a, b) => compareLocations(a.location, b.location));

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
        counts: {
          orderBy: { createdAt: 'desc' },
          include: { samples: { orderBy: { position: 'asc' } } },
        },
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
   * The plants a COUNTED field holds, or null when it has not been counted
   * (HARV-08).
   *
   * A sector count walks one metre of a row and the app works a whole line out
   * of it — a count's scope is one line, all seven rows — so the field is that
   * figure times the lines sown. Not every line has to have been counted for the
   * number to be useful, but it is only ever as good as the lines that were.
   *
   * Latest by COUNT DATE, the same way the harvest guard picks it, so the screen
   * and a refusal can never be reading different counts.
   */
  private fieldPlantsFromCount(ps: {
    counts: CountRow[];
    lines: number | null;
  }): number | null {
    let latest: { estimatedPlants: number; countDate: Date } | null = null;

    for (const count of ps.counts) {
      if (count.countType !== PlantCountType.ROW_METRE.toString()) continue;
      if (!latest || count.countDate > latest.countDate) {
        latest = {
          estimatedPlants: count.estimatedPlants,
          countDate: count.countDate,
        };
      }
    }

    if (!latest) return null;

    return latest.estimatedPlants * (ps.lines ?? 1);
  }

  /**
   * The row for a batch taken as a WHOLE rather than per tunnel: what the list
   * shows while nothing has been transported, and what `findOne` returns.
   *
   * The list and `findOne` each used to assemble their own copy of `inTunnel`,
   * `countSummary`, `harvested` and `remaining` — four fields with two owners,
   * which is how two endpoints that disagree about the same figure start
   * (PSTOCK-04).
   *
   * A FIELD (sector) batch is the exception (HARV-08). Its `expectedPlants` is
   * the SEED count, so subtracting harvested plants from it compared two
   * different things, and it left a field that had been picked bare still
   * showing plants standing. A field therefore keeps `expectedPlants` as what it
   * was SOWN with — so the column and every total built from it stay in one unit
   * — and carries what a count measured in `countedPlants`. `remaining` follows
   * the count, and is null until somebody counts the field, which the screens
   * say out loud rather than inventing a number.
   */
  private rowForWholeBatch(
    ps: PlantStockRelations,
    harvested: number,
  ): PlantStockRow {
    const isField = ps.ssmSowingId == null;
    // The plants a count measured standing in this field — null when nobody has
    // counted it.
    const countedPlants = isField ? this.fieldPlantsFromCount(ps) : null;

    return {
      ...ps,
      inTunnel: this.computeInTunnel(ps),
      countSummary: this.summariseCounts(ps.counts),
      // `expectedPlants` deliberately stays the figure it has always been — for
      // a field that is the SEEDS SOWN — so the column, and every total built
      // from it, keeps ONE unit. Putting the counted plants in its place made a
      // field's totals add seeds to plants (HARV-08). What a field is standing
      // is `countedPlants`; what is left of it is `remaining`.
      countedPlants,
      harvested,
      remaining: isField
        ? countedPlants == null
          ? null
          : countedPlants - harvested
        : ps.expectedPlants - harvested,
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
   * Averages the readings taken on one batch (SSM: one tunnel, LPM: the whole
   * batch) and breaks the LPM figures down per line.
   *
   * Lines are averaged individually because they genuinely differ — a line can
   * germinate markedly better or worse than its neighbour, which is the reason
   * for counting per line at all. `best` / `worst` expose that spread, and
   * `isBest` says which line holds the best figure — the clients only draw it.
   *
   * Every figure is POOLED by readings (PSTOCK-24, decided 2026-10-10): a count
   * contributes its rate once per SAMPLE it took on a line, so ten trays weigh
   * more than two. A count recorded before readings existed carries one weight, on
   * the line it names. The headline figure is pooled the same way, so a session
   * that walked one line and one that walked another are not equal if one of them
   * counted five times as much.
   */
  private summariseCounts(counts: CountRow[]): CountSummary {
    const rated = counts.filter((c) => c.germinationRate != null);

    if (rated.length === 0) {
      return {
        countCount: counts.length,
        germination: null,
        best: null,
        worst: null,
        lines: [],
      };
    }

    /** How much each reading weighs: one per sample it took (at least one). */
    const weightOf = (c: CountRow): number => {
      const taken = c.samples?.length ?? 0;
      return taken > 0 ? taken : 1;
    };

    // Per line: the rates, weighted by how many readings were taken on that line.
    const byLine = new Map<
      number,
      { rated: number; readings: number; counts: number }
    >();
    let weighted = 0;
    let weight = 0;

    for (const c of rated) {
      const rate = c.germinationRate as number;
      const perLine = new Map<number, number>();

      for (const sample of c.samples ?? []) {
        if (sample.line == null) continue;
        perLine.set(sample.line, (perLine.get(sample.line) ?? 0) + 1);
      }

      // A count with no readings, or with readings on no line at all, weighs on
      // the line it names — that is every count recorded before PSTOCK-24.
      if (perLine.size === 0 && c.line != null) perLine.set(c.line, 1);

      for (const [line, readings] of perLine) {
        const cur = byLine.get(line) ?? { rated: 0, readings: 0, counts: 0 };
        cur.rated += rate * readings;
        cur.readings += readings;
        cur.counts += 1;
        byLine.set(line, cur);
      }

      const taken = weightOf(c);
      weighted += rate * taken;
      weight += taken;
    }

    const lines = [...byLine.entries()]
      .map(([line, acc]) => ({
        line,
        countCount: acc.counts,
        germination: Number((acc.rated / acc.readings).toFixed(1)),
      }))
      .sort((a, b) => a.line - b.line);

    const best =
      lines.length > 0 ? Math.max(...lines.map((l) => l.germination)) : null;
    const worst =
      lines.length > 0 ? Math.min(...lines.map((l) => l.germination)) : null;

    return {
      countCount: counts.length,
      germination: Number((weighted / weight).toFixed(1)),
      best,
      worst,
      lines: lines.map((l) => ({ ...l, isBest: l.germination === best })),
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

    // The stage is a closed vocabulary (PSTOCK-05). Nothing calls this route
    // yet (PSTOCK-12, still open), but the check belongs where the write
    // happens: `syncBatchStage` computes this same field from the harvests, and
    // a third word typed in here would leave two screens calling one batch
    // differently.
    if (dto.currentStage !== undefined && !isPlantStage(dto.currentStage)) {
      throw new BadRequestException(notAPlantStage(dto.currentStage));
    }

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
   * The readings for ONE batch — saved as a whole.
   *
   * THIS is the shape the farm works in (decided 2026-10-11): **a batch has ONE
   * count**, with ONE germination figure, and the readings are what you keep
   * adding to it. Every visit used to create its own count row, so a batch walked
   * twice showed two figures and the operator had to work out which one the batch
   * was being judged by.
   *
   * The readings arrive as the COMPLETE list (PUT, not POST), so adding one,
   * correcting a typo and deleting one are the same act: save the list.
   *
   * Counts that already exist for the same batch and tunnel are MERGED into the
   * oldest of them, keeping every reading it holds — nothing recorded is thrown
   * away, and afterwards there is one.
   *
   * The maths, unchanged:
   *   SSM (TRAY)      density = plants / reading;  estimated = density x trays in
   *                   THAT tunnel;  germination = estimated / (trays x seedsPerTray)
   *   LPM (ROW_METRE) density = plants / reading (one metre of one row);
   *                   estimated = density x (meterPerLine x ROWS_PER_LINE);
   *                   germination = estimated / seedsPerLine, where seedsPerLine is
   *                   the seeds sown divided by the lines sown (confirmed by the
   *                   user 2026-10-10).
   *
   * The operator may count the plants present or the gaps; with gaps, the plants
   * follow from the seeds that ONE reading was sown with.
   */
  async saveCount(id: string, dto: SavePlantCountDto) {
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
    // so a closed season refuses it for everyone (decided 2026-10-04).
    // Repeating it means the service is safe on its own — a script, a seed, a
    // future route that forgets the interceptor — instead of relying on the one
    // place that happens to call it today.
    await this.seasonService.assertWritable(
      plantStock.ssmSowing?.seasonId ?? plantStock.lpmSowing?.seasonId,
    );

    const facts = this.batchFacts(plantStock, dto.countType);

    // Where this count lives: the tunnel for trays, the batch's own location for a
    // field sowing. That is the key a count is found by.
    let location: string;
    let todayBasis: CountBasis;

    if (facts.isTray) {
      const tunnel = dto.location?.trim();
      if (!tunnel) {
        throw new BadRequestException('Select the tunnel you counted.');
      }
      const trays = this.traysInLocation(plantStock, tunnel);
      if (trays <= 0) {
        throw new BadRequestException(
          `No trays of this sowing are in ${tunnel}.`,
        );
      }
      location = tunnel;
      todayBasis = {
        scopeSize: trays,
        seedsInScope: trays * facts.seedsPerSample,
      };
    } else {
      const seedsSown = plantStock.seedsSown || 0;
      if (seedsSown <= 0) {
        throw new BadRequestException(
          'This sowing has no seed quantity recorded, so it cannot be counted.',
        );
      }
      location = plantStock.location;
      todayBasis = {
        // A single line, all of its rows.
        scopeSize: toRowMetres(1, plantStock.meterPerLine ?? 0),
        // Exact: the seeds actually sown divided by the lines sown. Using the
        // stored `seedsPerMeter` here would inherit its integer rounding.
        seedsInScope: seedsSown / (facts.lines ?? 1),
      };
    }

    const existing = await this.prismaService.plantCount.findMany({
      where: { plantStockId: id, countType: dto.countType, location },
      orderBy: { createdAt: 'asc' },
    });

    // The oldest one is the count; the rest are merged into it below.
    const keeper = existing[0];

    // The basis a count was recorded on STAYS: correcting a reading tomorrow must
    // not re-derive it from what the tunnel holds today (PSTOCK-24).
    const basis: CountBasis =
      keeper?.scopeSize != null && keeper.seedsInScope != null
        ? { scopeSize: keeper.scopeSize, seedsInScope: keeper.seedsInScope }
        : todayBasis;

    const samples = this.buildSamples(dto.samples, facts);
    const summary = summariseSamples(samples, basis);

    return this.prismaService.$transaction(async (tx) => {
      const saved = keeper
        ? await tx.plantCount.update({
            where: { id: keeper.id },
            data: {
              ...summary,
              scopeSize: basis.scopeSize,
              seedsInScope: basis.seedsInScope,
              notes: dto.notes ?? null,
              // The readings are replaced wholesale: the list IS the count.
              samples: { deleteMany: {}, create: samples },
            },
            include: { samples: { orderBy: { position: 'asc' } } },
          })
        : await tx.plantCount.create({
            data: {
              plantStockId: id,
              countType: dto.countType,
              location,
              ...summary,
              scopeSize: basis.scopeSize,
              seedsInScope: basis.seedsInScope,
              notes: dto.notes ?? null,
              samples: { create: samples },
            },
            include: { samples: { orderBy: { position: 'asc' } } },
          });

      // Any other count for the same batch and tunnel is now part of the one
      // above — its readings came in with the list — so the extra rows go rather
      // than lingering as a second figure. Done AFTER the update, so a failure
      // here leaves the readings where they were.
      if (existing.length > 1) {
        await tx.plantCount.deleteMany({
          where: { id: { in: existing.slice(1).map((c) => c.id) } },
        });
      }

      return saved;
    });
  }

  /**
   * The batch's counting facts, checked — the part that does not depend on where
   * the trays are today, so appending readings can use it too.
   */
  private batchFacts(
    plantStock: {
      seedsPerTray: number | null;
      lines: number | null;
      meterPerLine: number | null;
      seedsPerMeter: number | null;
    },
    countType: PlantCountType,
  ): BatchFacts {
    const isTray = countType === PlantCountType.TRAY;

    if (isTray) {
      const seedsPerTray = plantStock.seedsPerTray ?? 0;
      if (seedsPerTray <= 0) {
        throw new BadRequestException(
          'This sowing has no seeds per tray, so it cannot be counted.',
        );
      }
      return { isTray, lines: null, seedsPerSample: seedsPerTray };
    }

    const lines = plantStock.lines ?? 0;
    const metresPerLine = plantStock.meterPerLine ?? 0;
    const seedsPerMeter = plantStock.seedsPerMeter ?? 0;

    if (lines <= 0 || metresPerLine <= 0 || seedsPerMeter <= 0) {
      throw new BadRequestException(
        'This sowing is missing its lines, line length or seeds per metre, so it cannot be counted.',
      );
    }

    return { isTray, lines, seedsPerSample: seedsPerMeter };
  }

  /**
   * The readings, checked and turned into rows.
   *
   * Every refusal names the reading by its position ("Reading 4"), because with
   * ten numbers on the screen "one of them is wrong" says nothing.
   */
  private buildSamples(
    samples: PlantCountSampleDto[],
    facts: BatchFacts,
  ): CountSampleRow[] {
    return samples.map((sample, index) => {
      const where = `Reading ${index + 1}`;
      const plantsGiven = sample.countedPlants !== undefined;
      const gapsGiven = sample.missingPlants !== undefined;

      if (plantsGiven === gapsGiven) {
        throw new BadRequestException(
          `${where}: enter either the plants you counted or the gaps you found, not both.`,
        );
      }

      if (facts.isTray && sample.line !== undefined) {
        throw new BadRequestException(
          `${where}: lines only apply to field (LPM) sowings.`,
        );
      }

      if (!facts.isTray) {
        if (sample.line === undefined) {
          throw new BadRequestException(
            `${where}: choose the line it came from.`,
          );
        }
        if (facts.lines != null && sample.line > facts.lines) {
          throw new BadRequestException(
            `${where}: this sowing only has ${facts.lines} ${facts.lines === 1 ? 'line' : 'lines'}.`,
          );
        }
      }

      const countedPlants =
        sample.countedPlants ??
        facts.seedsPerSample - (sample.missingPlants ?? 0);

      if (countedPlants < 0) {
        throw new BadRequestException(
          `${where}: more gaps than the ${facts.seedsPerSample} seeds that sample was sown with.`,
        );
      }

      return {
        // Trays belong to no line, so the column stays empty for them.
        line: facts.isTray ? null : (sample.line ?? null),
        countedPlants,
        missingPlants: sample.missingPlants ?? null,
        // The order they were entered in. Readings are saved as a whole list, so
        // this is simply where the reading sits in it.
        position: index,
      };
    });
  }

  /**
   * Take one count back out (PSTOCK-10, decided 2026-10-08).
   *
   * Every count is averaged into that line's germination figure, and until now a
   * count could only be ADDED: a mistyped sample (`100` instead of `10`) stayed in
   * the average for ever and could not even be seen, because neither screen listed
   * the counts. The figure an operator looked at was therefore built partly from a
   * number they had no way of correcting.
   *
   * A HARD delete, with both screens asking "are you sure?" first. The act is a
   * correction, not a log: keeping a "cancelled" row would cost a column, a filter
   * in every summary, and a second meaning for every list that shows counts.
   *
   * The season rule is the one `saveCount` repeats (PSTOCK-03): a count is
   * evidence about a season that has been reported on, so once that season is
   * closed nothing changes it — the administrator's exemption included, since a
   * close report must not become improvable after the fact.
   */
  async removeCount(countId: string) {
    const count = await this.prismaService.plantCount.findUnique({
      where: { id: countId },
      select: {
        id: true,
        plantStock: {
          select: {
            id: true,
            ssmSowing: { select: { seasonId: true } },
            lpmSowing: { select: { seasonId: true } },
          },
        },
      },
    });

    if (!count) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    await this.seasonService.assertWritable(
      count.plantStock.ssmSowing?.seasonId ??
        count.plantStock.lpmSowing?.seasonId,
    );

    await this.prismaService.plantCount.delete({ where: { id: countId } });

    // The batch id comes back so the caller can refresh exactly what changed.
    return { message: 'Count deleted', plantStockId: count.plantStock.id };
  }
}
