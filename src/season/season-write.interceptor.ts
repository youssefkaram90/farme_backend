import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { SeasonService } from './season.service';
import { UserRole } from '../users/enums/userRole.enum';

/**
 * How to find a record's season.
 *
 * Nearly every model carries a plain `seasonId` column; children (`PlantStock`,
 * a plan entry, a tray assignment) have none, so they are reached through their
 * parent. A record that belongs to no season at all is handled by `globalRule`.
 */
type SeasonReader = (
  db: PrismaService,
  id: string,
) => Promise<string | null | undefined>;

/** Where a rule finds the record it has to judge. */
type Locator = (
  request: { body?: unknown },
  url: string[],
) => string | undefined;

type SeasonWriteRule = {
  /** Route path WITHOUT the global `/api` prefix. `:name` marks a parameter. */
  path: string;
  regex: RegExp;
  /** The id to look up — a URL parameter unless the route carries it elsewhere. */
  locate: Locator;
  /** The season the named record belongs to. */
  read?: SeasonReader;
  /**
   * For a record that belongs to NO season (the global product catalogue):
   * the code of a closed season that already uses it, if any. Such a record is
   * judged by who has already reported on it, not by a column of its own.
   */
  usedInClosedSeason?: (
    db: PrismaService,
    id: string,
  ) => Promise<string | null>;
  /** Wording aid for a `usedInClosedSeason` rule in the refusal sentence. */
  describedAs?: string;
};

/** Default: the first URL parameter is the record's id. */
const param =
  (index = 1): Locator =>
  (_request, url) =>
    url[index];

/** Every record id in this schema is a UUID, so anything else names no row. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** For the two `execute` routes, where the plan arrives in the JSON body. */
const body =
  (field: string): Locator =>
  (request) => {
    const value = (request.body as Record<string, unknown> | undefined)?.[
      field
    ];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  };

/** Most season-scoped models carry the season id themselves. */
const byColumn =
  (
    pick: (
      db: PrismaService,
      id: string,
    ) => Promise<{ seasonId: string } | null>,
  ): SeasonReader =>
  async (db, id) =>
    (await pick(db, id))?.seasonId;

const rule = (
  path: string,
  read: SeasonReader,
  locate: Locator = param(),
): SeasonWriteRule => ({
  path,
  read,
  locate,
  regex: new RegExp(`^${path.replace(/:[^/]+/g, '[^/]+')}$`),
});

/** A record with no season of its own — see `usedInClosedSeason`. */
const globalRule = (
  path: string,
  usedInClosedSeason: (db: PrismaService, id: string) => Promise<string | null>,
  describedAs: string,
  locate: Locator = param(),
): SeasonWriteRule => ({
  path,
  locate,
  describedAs,
  usedInClosedSeason,
  regex: new RegExp(`^${path.replace(/:[^/]+/g, '[^/]+')}$`),
});

/** The season a sowing plan belongs to — the parent of its entries. */
const readPlanSeason: SeasonReader = byColumn((db, id) =>
  db.sowingPlan.findUnique({ where: { id }, select: { seasonId: true } }),
);

/** The season a crop care plan belongs to. */
const readCropCarePlanSeason: SeasonReader = byColumn((db, id) =>
  db.cropCarePlan.findUnique({ where: { id }, select: { seasonId: true } }),
);

/** An entry has no season of its own: it belongs to its plan's. */
const readPlanEntrySeason: SeasonReader = byColumn(async (db, id) => {
  const entry = await db.sowingPlanEntry.findUnique({
    where: { id },
    select: { plan: { select: { seasonId: true } } },
  });
  return entry === null ? null : { seasonId: entry.plan.seasonId };
});

/** Same for a crop care plan entry. */
const readCropCareEntrySeason: SeasonReader = byColumn(async (db, id) => {
  const entry = await db.cropCarePlanEntry.findUnique({
    where: { id },
    select: { plan: { select: { seasonId: true } } },
  });
  return entry === null ? null : { seasonId: entry.plan.seasonId };
});

/**
 * Plant stock has no `seasonId` of its own, so it is reached through the sowing
 * that created it.
 */
const readPlantStockSeason: SeasonReader = async (db, id) => {
  const row = await db.plantStock.findUnique({
    where: { id },
    select: {
      ssmSowing: { select: { seasonId: true } },
      lpmSowing: { select: { seasonId: true } },
    },
  });
  return row?.ssmSowing?.seasonId ?? row?.lpmSowing?.seasonId ?? null;
};

/** A tray assignment borrows the season of the sowing it transports. */
const readAssignmentSeason: SeasonReader = byColumn(async (db, id) => {
  const row = await db.sowingTunnelAssignment.findUnique({
    where: { id },
    select: { ssmSowing: { select: { seasonId: true } } },
  });
  return row === null ? null : { seasonId: row.ssmSowing.seasonId };
});

/** A stock lot carries its season itself. */
const readStockItemSeason: SeasonReader = byColumn((db, id) =>
  db.stockItem.findUnique({ where: { id }, select: { seasonId: true } }),
);

/** `AgriInputSeason` is a product's row PER SEASON, so it carries one too. */
const readAgriInputSeason: SeasonReader = byColumn((db, id) =>
  db.agriInputSeason.findUnique({ where: { id }, select: { seasonId: true } }),
);

/** A sowing, reached from the tray-transport screens. */
const readSsmSeason: SeasonReader = byColumn((db, id) =>
  db.sowingSSM.findUnique({ where: { id }, select: { seasonId: true } }),
);

/** A tunnel. */
const readTunnelSeason: SeasonReader = byColumn((db, id) =>
  db.tunnel.findUnique({ where: { id }, select: { seasonId: true } }),
);

/**
 * A crop-protection product is GLOBAL: typed once and used by every season, so
 * it has no season of its own to compare. What makes it untouchable
 * is that a season which is already closed has booked quantities against it —
 * renaming or deleting it would rewrite that season's ledger after the fact.
 */
const productUsedInClosedSeason = async (
  db: PrismaService,
  id: string,
): Promise<string | null> => {
  const row = await db.agriInputSeason.findFirst({
    where: { productId: id, season: { status: { not: 'ACTIVE' } } },
    select: { season: { select: { code: true } } },
    orderBy: { season: { startDate: 'desc' } },
  });
  return row?.season.code ?? null;
};

/**
 * Every route that targets an existing record — a write or a read.
 *
 * Only routes that NAME a record are listed: a *create* is stamped with the open
 * season, so there is nothing to check. The verb is not part of the decision — a
 * POST that reaches into an existing record is listed here like any other
 * (P7-01), and so is a GET that opens one by id (X-02).
 */
export const RULES: SeasonWriteRule[] = [
  rule(
    '/deliveries/:id',
    byColumn((db, id) =>
      db.delivery.findUnique({ where: { id }, select: { seasonId: true } }),
    ),
  ),
  rule(
    '/harvest-records/:id',
    byColumn((db, id) =>
      db.harvestRecord.findUnique({
        where: { id },
        select: { seasonId: true },
      }),
    ),
  ),
  rule(
    '/shipments/:id',
    byColumn((db, id) =>
      db.shipment.findUnique({ where: { id }, select: { seasonId: true } }),
    ),
  ),
  rule(
    '/trucks/:id',
    byColumn((db, id) =>
      db.truck.findUnique({ where: { id }, select: { seasonId: true } }),
    ),
  ),
  rule(
    '/tunnels/:id',
    byColumn((db, id) =>
      db.tunnel.findUnique({ where: { id }, select: { seasonId: true } }),
    ),
  ),
  rule(
    '/sectors/:id',
    byColumn((db, id) =>
      db.sector.findUnique({ where: { id }, select: { seasonId: true } }),
    ),
  ),
  rule(
    '/sowing-ssm/:id',
    byColumn((db, id) =>
      db.sowingSSM.findUnique({ where: { id }, select: { seasonId: true } }),
    ),
  ),
  rule(
    '/sowing-lpm/:id',
    byColumn((db, id) =>
      db.sowingLPM.findUnique({ where: { id }, select: { seasonId: true } }),
    ),
  ),
  rule('/sowing-plans/:id', readPlanSeason),
  rule('/sowing-plans/:id/status', readPlanSeason),
  rule('/crop-care-plans/:id', readCropCarePlanSeason),
  rule('/crop-care-plans/:id/status', readCropCarePlanSeason),
  rule(
    '/crop-operations/:id',
    byColumn((db, id) =>
      db.cropOperation.findUnique({
        where: { id },
        select: { seasonId: true },
      }),
    ),
  ),
  rule(
    '/phytosanitary-program/:id',
    byColumn((db, id) =>
      db.phytosanitaryProgram.findUnique({
        where: { id },
        select: { seasonId: true },
      }),
    ),
  ),
  rule('/plant-stock/:id', readPlantStockSeason),

  // --- children: the season lives on the parent -----------------------------
  rule('/sowing-plans/entries/:entryId', readPlanEntrySeason),
  rule('/sowing-plans/entries/:entryId/close', readPlanEntrySeason),
  rule('/crop-care-plans/entries/:entryId', readCropCareEntrySeason),
  rule('/tray-transport/:id', readAssignmentSeason),

  // --- POSTs that reach INTO an existing record -----------------------------
  rule('/sowing-plans/:planId/entries', readPlanSeason),
  rule('/sowing-plans/:planId/entries/bulk', readPlanSeason),
  rule('/crop-care-plans/:id/entries', readCropCarePlanSeason),
  rule('/crop-care-plans/entries/:entryId/execute', readCropCareEntrySeason),
  rule('/plant-stock/:id/counts', readPlantStockSeason),

  // The plan is in the JSON body on these two, not in the URL.
  rule('/sowing-ssm/execute', readPlanSeason, body('planId')),
  rule('/sowing-lpm/execute', readPlanSeason, body('planId')),

  // --- records that are only ever opened by id ------------------------------
  // A read needs a rule as much as a write does: the lists filter by season,
  // but "open this id" used to hand over any season at all (X-02).
  //
  // The lot id arrives in the JSON BODY on this one, not in the URL — a POST to
  // a fixed path otherwise falls through every rule, and `/stock/adjust` was in
  // fact matched by `/stock/:id` and then skipped because `adjust` is not a UUID
  // (STOCK-01). Nothing changes today: the route is ADMIN-only and an admin is
  // exempt from the closed-season rule by design — only an administrator may
  // correct a season that is already closed. It is listed so the day
  // that route is opened to a permission, it is judged.
  rule('/stock/adjust', readStockItemSeason, body('stockItemId')),
  rule('/stock/:id', readStockItemSeason),
  rule('/stock/:id/movements', readStockItemSeason),
  rule('/agri-inputs/:id', readAgriInputSeason),
  rule('/agri-inputs/:id/movements', readAgriInputSeason),
  rule('/tray-transport/sowing/:ssmSowingId', readSsmSeason),
  rule('/tray-transport/tunnel/:tunnelId', readTunnelSeason),

  // --- a global record: no season of its own --------------------------------
  globalRule(
    '/phytosanitary-products/:id',
    productUsedInClosedSeason,
    'product',
  ),
];

/**
 * Refuses a change to a record that belongs to a season which is not the open
 * one (P4-09, which absorbed P2-05).
 *
 * One interceptor instead of a check inside every service, because the rule
 * needs the caller's role and a service has no idea who is calling. Threading
 * `isAdmin` down would have meant adding `@CurrentUser()` and an extra argument
 * to ~20 controller methods as well; here the request already carries both the
 * user and the URL.
 *
 * It judges every write, not only a change or a delete (P7-01): recording a
 * sowing against an old plan entry writes a NEW sowing and moves the OLD entry
 * in the same breath, so the verb says nothing about which season is touched —
 * the route does.
 *
 * It judges reads as well (X-02): a list filters by season, but a record can
 * also be opened by its id, where an old link used to show a normal user a
 * closed season's row. The wrong season answers with the ordinary 404.
 *
 * The class name is historical — it began life as the write guard.
 *
 * It is deliberately forgiving: a URL that matches no rule, or a row that no
 * longer exists, is left to the service exactly as before. Blocking on a guess
 * would be worse than not blocking — and the service still answers with its own
 * 404. `SeasonService.assertWritable()` owns the actual rule.
 */
@Injectable()
export class SeasonWriteInterceptor implements NestInterceptor {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly seasonService: SeasonService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const method = String(request?.method ?? '').toUpperCase();

    // Reads are judged too, and that is the other half of the rule (X-02): the
    // lists filter by season, but "open this id" used to hand over any season at
    // all. A write is judged because adding a row can rewrite a closed season's
    // record (P7-01).
    const isRead = method === 'GET' || method === 'HEAD';
    const isWrite =
      method === 'POST' ||
      method === 'PATCH' ||
      method === 'PUT' ||
      method === 'DELETE';

    if (!isRead && !isWrite) {
      return next.handle();
    }

    const target = this.findTarget(String(request?.url ?? ''), request);

    if (target) {
      const isAdmin = request?.user?.role === UserRole.ADMIN;
      const { read, usedInClosedSeason, describedAs } = target.rule;

      if (read) {
        const recordSeasonId = await read(this.prismaService, target.id);

        if (isRead) {
          // Another season's record answers as if it did not exist, so nothing
          // is revealed by asking for it.
          this.seasonService.assertReadable(recordSeasonId);
        } else {
          await this.seasonService.assertWritable(recordSeasonId, isAdmin);
        }
      } else if (usedInClosedSeason && isWrite) {
        // A global record (the product catalogue): the question is not which
        // season it belongs to, but who has already booked against it. Only a
        // write can damage it, so a read is left to the service.
        const closedSeasonCode = await usedInClosedSeason(
          this.prismaService,
          target.id,
        );

        if (!isAdmin && closedSeasonCode) {
          throw new ConflictException(
            `This ${describedAs ?? 'record'} is already used in season ${closedSeasonCode}, which is closed. Only an administrator can change it.`,
          );
        }
      }
    }

    return next.handle();
  }

  /**
   * Find the rule for a URL.
   *
   * The first `:param` in every rule is the record's id — the paths that carry
   * a second segment (`/status`) put the id first on purpose, so the parameter
   * names never have to be read here. The two `execute` routes carry their id in
   * the body instead, which is what `locate` is for.
   */
  private findTarget(url: string, request: { body?: unknown }) {
    const path = (url.split('?')[0] ?? '').replace(/^\/api/, '');

    for (const candidate of RULES) {
      const found = path.match(candidate.regex);
      if (!found) continue;

      const id = candidate.locate(request, found);
      // A non-UUID id cannot name a row: leave it to the service instead of
      // asking the database, which would only raise a Prisma validation error
      // here, before the service gets to say anything (SEASON-05).
      if (id && UUID_PATTERN.test(id)) {
        return { rule: candidate, id };
      }
    }

    return null;
  }
}
