import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ERROR_MESSAGES } from '../common/error-messages';
import {
  formatSeasonDate,
  isValidSeasonCode,
  nextSeasonCode,
  seasonBounds,
  startYearFromCode,
} from '../common/season-code';
import { seasonViewStore } from './season-view.store';

/** The open season, as held in memory. */
export type ActiveSeason = { id: string; code: string };

/** How the open season lines up with today's date. */
export type SeasonAlignmentState =
  'ALIGNED' | 'OPEN_AHEAD' | 'OPEN_BEHIND' | 'NONE';

export type SeasonAlignment = {
  state: SeasonAlignmentState;
  /** The code of the season whose dates contain today, when there is one. */
  coversToday: string | null;
  /** One plain sentence for the caller; `null` while everything lines up. */
  message: string | null;
};

@Injectable()
export class SeasonService implements OnModuleInit {
  /**
   * The one open season.
   *
   * Kept in memory because every season-scoped record creation reads it — a
   * database query on every create would be wasteful for a value that changes
   * about once a year. It is *not* an authority: `SeasonFreshnessInterceptor`
   * refreshes it before each request, and `assertWritable()` checks a record's
   * own season against the database rather than against this field. A stale copy
   * must never be able to decide anything (P7-01).
   */
  private active: ActiveSeason | null = null;

  /** When `active` was last read. */
  private refreshedAt = 0;

  /**
   * How long a cached open season may be reused, in milliseconds.
   *
   * 0 — the default — means every request re-reads it, so the answer is never
   * older than the request itself. Raise it only to trade correctness for fewer
   * queries, never to make a decision on it.
   */
  private readonly cacheTtlMs = Number(process.env.SEASON_CACHE_TTL_MS ?? 0);

  constructor(private readonly prismaService: PrismaService) {}

  async onModuleInit() {
    await this.refreshActive();
  }

  /**
   * Refresh the open season, unless the cached copy is younger than the TTL.
   * Called once per request by `SeasonFreshnessInterceptor`.
   */
  async ensureFreshActive() {
    if (
      this.cacheTtlMs > 0 &&
      Date.now() - this.refreshedAt < this.cacheTtlMs
    ) {
      return;
    }

    await this.refreshActive();
  }

  async refreshActive() {
    this.active = await this.prismaService.season.findFirst({
      where: { status: 'ACTIVE' },
      select: { id: true, code: true },
      orderBy: { startDate: 'desc' },
    });
    this.refreshedAt = Date.now();
  }

  /** The open season, or null when none is open (e.g. a brand-new install). */
  getActive(): ActiveSeason | null {
    return this.active;
  }

  /**
   * The id every season-scoped record is stamped with.
   *
   * Deliberately throws instead of returning null: writing a record with no
   * season produces data nobody could ever find again.
   */
  getActiveSeasonId(): string {
    // An administrator browsing another season gets that one instead — see
    // SeasonViewInterceptor. It is only ever installed on a GET, which is what
    // keeps it safe: a WRITE can never be stamped with a season that is not the
    // open one. This is also why the switcher needed no change anywhere else:
    // every list already asks this one method.
    const scoped = this.getScopedSeasonId();
    if (scoped) return scoped;

    if (!this.active) {
      throw new ConflictException(
        'No season is open. Ask an administrator to open the new season before adding records.',
      );
    }
    return this.active.id;
  }

  /**
   * Does the open season still match the calendar?
   *
   * The open season decides where records go (decided 2026-09-30) — the clock is
   * the check, never the authority. The two mismatches are not symmetric:
   * opening a season early is deliberate (its work is finished), while
   * *forgetting* to open the new one leaves everybody typing into a season that
   * has already ended. The wording says which is which, and what to do.
   *
   * Never blocks anything: this is a sentence for a banner, not a rule.
   */
  async getAlignment(isAdmin: boolean): Promise<SeasonAlignment> {
    const now = new Date();
    const open = this.active;

    const covering = await this.prismaService.season.findFirst({
      where: { startDate: { lte: now }, endDate: { gte: now } },
      select: { id: true, code: true },
      orderBy: { startDate: 'desc' },
    });

    if (!open) {
      const askAdmin = isAdmin
        ? 'Open it to start adding records.'
        : 'Ask an administrator to open it.';

      return {
        state: 'NONE',
        coversToday: covering?.code ?? null,
        message: covering
          ? `Season ${covering.code} has not been opened yet. ${askAdmin}`
          : "No season covers today's date yet. Ask an administrator to create it.",
      };
    }

    if (covering && covering.id === open.id) {
      return { state: 'ALIGNED', coversToday: covering.code, message: null };
    }

    const openRow = await this.prismaService.season.findUnique({
      where: { id: open.id },
      select: { startDate: true, endDate: true },
    });
    if (!openRow) {
      return {
        state: 'ALIGNED',
        coversToday: covering?.code ?? null,
        message: null,
      };
    }

    const fallsIn = covering ? `season ${covering.code}` : 'no season';

    if (openRow.startDate.getTime() > now.getTime()) {
      return {
        state: 'OPEN_AHEAD',
        coversToday: covering?.code ?? null,
        message:
          `Season ${open.code} is open, but it starts on ` +
          `${formatSeasonDate(openRow.startDate)}. Today, ` +
          `${formatSeasonDate(now)}, falls in ${fallsIn}. New records go into ` +
          `${open.code}.`,
      };
    }

    const whatToDo = isAdmin
      ? `Open season ${nextSeasonCode(open.code)} to keep adding records.`
      : 'Ask an administrator to open the new season.';

    return {
      state: 'OPEN_BEHIND',
      coversToday: covering?.code ?? null,
      message:
        `Season ${open.code} is still open, but it ended on ` +
        `${formatSeasonDate(openRow.endDate)}. ${whatToDo}`,
    };
  }

  /**
   * The season this request is scoped to.
   *
   * The season an administrator is viewing through the switcher (installed by
   * SeasonViewInterceptor), otherwise the open one. `null` when nothing is open.
   */
  getScopedSeasonId(): string | null {
    const viewed = seasonViewStore.getStore();
    if (viewed) return viewed;

    return this.active?.id ?? null;
  }

  /**
   * The season an administrator is browsing, when it is not the open one.
   *
   * `null` in every ordinary case: no switcher cookie at all, or a cookie that
   * names the open season — browsing the open season is not "browsing". The code
   * has to come from the database, because the request store holds only an id.
   *
   * This is what lets a client NAMING a season agree with the data it is showing
   * (SEASON-06).
   */
  async getViewing(): Promise<ActiveSeason | null> {
    const viewed = seasonViewStore.getStore();
    if (!viewed || viewed === this.active?.id) return null;

    return this.prismaService.season.findUnique({
      where: { id: viewed },
      select: { id: true, code: true },
    });
  }

  /**
   * Refuse to READ a record that belongs to a season the caller is not scoped to
   * — the read side of `assertWritable()`.
   *
   * Without it every list filtered by season while a single record could still be
   * opened by its id, so a link left over from last season handed a normal user
   * data from a closed season — which is nobody's business but an
   * administrator's.
   *
   * Answered with the ordinary "no such record" 404, never a refusal: telling
   * somebody they are not allowed would confirm the record is there.
   *
   * Synchronous on purpose — it compares against the season this request is
   * scoped to, which SeasonFreshnessInterceptor has already refreshed, so no
   * query is needed.
   */
  assertReadable(recordSeasonId: string | null | undefined): void {
    // No season on the row: a child table, judged through its parent.
    if (!recordSeasonId) return;

    const scoped = this.getScopedSeasonId();
    if (scoped && scoped === recordSeasonId) return;

    throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
  }

  /**
   * Refuse a date that does not fall inside the season the record belongs to.
   *
   * A record's own date is what its season's numbers are built from: a delivery
   * dated 25 March sitting in season 27-28 (which starts 1 July) silently skews
   * every total that season will ever report, and nothing else in the system
   * looks at it (decided 2026-09-30: refuse it, do not merely warn).
   *
   * @param date  when the work happened
   * @param label how to name that date to the user, e.g. "delivery date"
   * @param seasonId the season the record belongs to; omitted on a create,
   *   where the open season is the one that will stamp the record
   */
  async assertDateInSeason(
    date: Date,
    label: string,
    seasonId?: string,
  ): Promise<void> {
    const owner = seasonId ?? this.getActiveSeasonId();

    const season = await this.prismaService.season.findUnique({
      where: { id: owner },
      select: { code: true, startDate: true, endDate: true },
    });
    // A row pointing at a season that no longer exists is not this rule's
    // business; let the service decide what to do with it.
    if (!season) return;

    if (date >= season.startDate && date <= season.endDate) return;

    const day = formatSeasonDate(date);

    // Which season, if any, does it belong to? That is what the user needs to
    // be told — not which one it does not.
    const elsewhere = await this.prismaService.season.findFirst({
      where: { startDate: { lte: date }, endDate: { gte: date } },
      select: { code: true },
      orderBy: { startDate: 'desc' },
    });

    if (elsewhere) {
      throw new BadRequestException(
        `The ${label} (${day}) falls in season ${elsewhere.code}, not in ${season.code}. Ask an administrator to record it there.`,
      );
    }

    throw new BadRequestException(
      `The ${label} (${day}) does not fall inside season ${season.code} (${formatSeasonDate(season.startDate)} to ${formatSeasonDate(season.endDate)}). Please check the date.`,
    );
  }

  /**
   * Refuse a change to a record that belongs to a season that is not the open
   * one.
   *
   * The rule is asymmetric on purpose, and it is the same rule as everywhere
   * else in the season work: **the open season stamps new records, a record's
   * own season governs existing ones**. Changing a closed season's figures after
   * they have been reported would quietly rewrite what somebody already has on
   * paper — so a normal user is refused, and only an administrator may still
   * correct it.
   *
   * Called by `SeasonWriteInterceptor` for every write that names a
   * season-scoped record, and for every read of one (`assertReadable`).
   */
  async assertWritable(
    recordSeasonId: string | null | undefined,
    isAdmin: boolean,
  ) {
    if (isAdmin) return;
    // No season on the row: a child table, judged through its parent.
    if (!recordSeasonId) return;

    // Asked of the DATABASE, not of the in-memory copy: this is the check that
    // must not be wrong. A record is writable when its own season is the open
    // one, and only one season can be open (activate() enforces that).
    const season = await this.prismaService.season.findUnique({
      where: { id: recordSeasonId },
      select: { code: true, status: true },
    });
    // A row pointing at a season that no longer exists is not this rule's
    // business; let the service decide what to do with it.
    if (!season) return;
    if (season.status === 'ACTIVE') return;

    throw new ConflictException(
      `That record belongs to season ${season.code}, which is closed. Only an administrator can change it.`,
    );
  }

  findAll() {
    return this.prismaService.season.findMany({
      orderBy: { startDate: 'desc' },
    });
  }

  async findOne(id: string) {
    const season = await this.prismaService.season.findUnique({
      where: { id },
    });
    if (!season) {
      throw new NotFoundException('This season no longer exists.');
    }
    return season;
  }

  /**
   * Create a season from its code, e.g. "26-27".
   *
   * The dates are derived ONCE here from the single 1-July rule and then
   * stored, so a later change to that rule cannot re-label this season.
   *
   * The season is created CLOSED. Activating it is a separate, deliberate
   * step, so a second season can never quietly become the open one.
   */
  async create(code: string) {
    if (!isValidSeasonCode(code)) {
      throw new BadRequestException('A season must look like "26-27".');
    }

    const { startDate, endDate } = seasonBounds(startYearFromCode(code));

    const existing = await this.prismaService.season.findFirst({
      where: { code },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(`Season ${code} already exists.`);
    }

    const overlapping = await this.prismaService.season.findFirst({
      where: { startDate: { lte: endDate }, endDate: { gte: startDate } },
      select: { code: true },
    });
    if (overlapping) {
      throw new ConflictException(
        `Season ${code} overlaps season ${overlapping.code}.`,
      );
    }

    return this.prismaService.season.create({
      data: { code, startDate, endDate, status: 'CLOSED' },
    });
  }

  /**
   * Make a season the open one. Refuses while another season is still open, so
   * there is never any doubt about where new records go.
   */
  async activate(id: string) {
    const season = await this.findOne(id);

    const other = await this.prismaService.season.findFirst({
      where: { status: 'ACTIVE', id: { not: id } },
      select: { code: true },
    });
    if (other) {
      throw new ConflictException(
        `Season ${other.code} is still open. Close it before opening season ${season.code}.`,
      );
    }

    const updated = await this.prismaService.season.update({
      where: { id },
      data: { status: 'ACTIVE', activatedAt: new Date(), closedAt: null },
    });

    await this.refreshActive();
    return updated;
  }
}
