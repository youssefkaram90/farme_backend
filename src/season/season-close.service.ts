import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlantStockService } from '../plant-stock/plant-stock.service';
import { Prisma } from '../generated/prisma/client';
import { SeasonService } from './season.service';
import { formatQuantity } from '../common/format-quantity';
import {
  formatSeasonDate,
  nextSeasonCode,
  seasonBounds,
  startYearFromCode,
} from '../common/season-code';
import type { Actor } from '../common/actor';

/** Either the plain client or a transaction client — the checks accept both. */
type Db = PrismaService | Prisma.TransactionClient;

/**
 * Sent by the close action to mean "the following season". A season id can
 * never be this, because ids are UUIDs.
 */
const OPEN_NEXT = 'next';

/** Every season id is a UUID, so anything else names no row. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One finding in the close report. */
export type CloseFinding = {
  /** One plain sentence for the user. */
  message: string;
  /** Per-item lines, e.g. one per leftover product. */
  details: string[];
};

export type ClosePreview = {
  season: { id: string; code: string };
  /**
   * The season that follows this one. `id` is null while it does not exist yet
   * — closing creates it, so it is always safe to offer as a choice.
   */
  nextSeason: { id: string | null; code: string };
  /** While this is non-empty the close is refused. */
  blocks: CloseFinding[];
  /** Shown for acknowledgement; the close may still go ahead. */
  warnings: CloseFinding[];
  /** Read-only context, e.g. the closing stock balances. */
  info: CloseFinding[];
  canClose: boolean;
};

/** What a close answers with — the season closed, and the one it opened. */
export type CloseResult = {
  closed: { id: string; code: string };
  /** `null` when the administrator chose to open no season. */
  opened: { id: string; code: string } | null;
};

@Injectable()
export class SeasonCloseService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly seasonService: SeasonService,
    private readonly plantStockService: PlantStockService,
  ) {}

  /**
   * What closing this season would do. Called by the preview endpoint AND again
   * inside the close transaction (P4-07), so the checks the admin saw are the
   * checks that actually gate the close.
   */
  async buildPreview(seasonId: string): Promise<ClosePreview> {
    const season = await this.prismaService.season.findUnique({
      where: { id: seasonId },
      select: { id: true, code: true, status: true },
    });

    if (!season) {
      throw new NotFoundException('This season no longer exists.');
    }

    if (season.status !== 'ACTIVE') {
      throw new ConflictException(
        `Season ${season.code} is not the open season, so it cannot be closed.`,
      );
    }

    const [blocks, warningGroups, info, incompleteShipments, nextSeason] =
      await Promise.all([
        this.findLeftoverGoods(season.id),
        this.findStandingThings(season.id),
        this.findClosingStockBalances(season.id),
        this.findIncompleteShipments(season.id),
        this.findNextSeason(season.code),
      ]);

    return {
      season: { id: season.id, code: season.code },
      nextSeason,
      blocks,
      // The unfinished-record warning joins the standing-things ones: both are
      // things to look at, neither stops the close (SEASON-02).
      warnings: [...warningGroups, ...incompleteShipments],
      info,
      canClose: blocks.length === 0,
    };
  }

  /**
   * The season that follows the given code, with its id when it already exists.
   *
   * A `null` id means the season does not exist yet and closing will create it.
   * Answering this in the preview is what lets the close wizard offer "open the
   * next season" before that season exists — without the client having to know
   * the season-code rule.
   */
  private async findNextSeason(
    code: string,
  ): Promise<{ id: string | null; code: string }> {
    const nextCode = nextSeasonCode(code);

    const row = await this.prismaService.season.findUnique({
      where: { code: nextCode },
      select: { id: true },
    });

    return { id: row?.id ?? null, code: nextCode };
  }

  /**
   * Harvested and boxed, but not shipped. This BLOCKS the close: the next season
   * starts with an empty pool and nothing is copied, so anything left
   * here would be unreachable — no shipment could ever draw from it again.
   */
  private async findLeftoverGoods(seasonId: string): Promise<CloseFinding[]> {
    const leftovers = await this.findLeftovers(this.prismaService, seasonId);

    if (leftovers.length === 0) return [];

    return [
      {
        message:
          'Harvested plants are still in stock. Ship them, or write them off, before closing the season.',
        details: leftovers.map(
          (p) =>
            `${p.name} (code ${p.planteCode}, ${p.plantsPerBox} per box) — ${Math.floor(
              p.currentQuantity / p.plantsPerBox,
            ).toLocaleString('en-GB')} boxes left`,
        ),
      },
    ];
  }

  /**
   * Plants still standing, and sowing plans never completed. Only WARNINGS: the
   * close does not destroy either, but neither can be finished afterwards.
   */
  private async findStandingThings(seasonId: string): Promise<CloseFinding[]> {
    const warnings: CloseFinding[] = [];

    // Reuses the plant-stock screen's own maths rather than computing
    // "expected minus harvested" a second time, where the two could drift apart —
    // but for THIS season: the active one is whatever the administrator happens
    // to be browsing, which is not the season being closed (SEASON-01).
    const rows = await this.plantStockService.findAllForSeason(seasonId);
    const standing = rows.filter((r) => (r.remaining ?? 0) > 0);

    if (standing.length > 0) {
      warnings.push({
        message:
          'Some batches still have plants standing. They cannot be harvested once the season is closed.',
        details: standing.map(
          (r) =>
            `${r.variety} in ${r.location} — about ${Number(r.remaining).toLocaleString('en-GB')} plants`,
        ),
      });
    }

    const plans = await this.prismaService.sowingPlan.findMany({
      where: { seasonId, status: { not: 'COMPLETED' } },
      select: { name: true, status: true },
      orderBy: { name: 'asc' },
    });

    if (plans.length > 0) {
      warnings.push({
        message: `${plans.length} sowing plan(s) are not completed.`,
        details: plans.map((p) => `${p.name} — ${p.status}`),
      });
    }

    return warnings;
  }

  /**
   * Shipments that were opened and never filled in.
   *
   * A shipment records what a truck took: number, date, truck, and lines. There
   * is no status and no "delivered" flag, so the only unfinished signal the data
   * can give is a header with no boxes under it — somebody started the entry and
   * never came back (SEASON-02). WARNING only: a bookkeeping slip, not stock
   * sitting in the shed.
   */
  private async findIncompleteShipments(
    seasonId: string,
  ): Promise<CloseFinding[]> {
    const empty = await this.prismaService.shipment.findMany({
      where: { seasonId, lines: { none: {} } },
      select: {
        shipmentNumber: true,
        shipmentDate: true,
        truck: { select: { name: true } },
      },
      orderBy: { shipmentDate: 'asc' },
    });

    if (empty.length === 0) return [];

    return [
      {
        message: `${empty.length} shipment(s) have no boxes recorded. Fill them in, or delete them, before closing the season.`,
        details: empty.map(
          (s) =>
            `${s.shipmentNumber} · ${formatSeasonDate(s.shipmentDate)} · ${s.truck.name} — no boxes`,
        ),
      },
    ];
  }

  /**
   * What the season ends with. INFO only, and deliberately NOT copied forward
   * (both rules): the difference between these numbers and what you enter next season
   * is exactly what was used, returned or thrown away.
   *
   * All three season-scoped balances: seeds, peat AND crop protection/fertiliser.
   * The first two used to be listed while a shed full of chemicals was silently
   * omitted (SEASON-02).
   */
  private async findClosingStockBalances(
    seasonId: string,
  ): Promise<CloseFinding[]> {
    const items = await this.prismaService.stockItem.findMany({
      where: { seasonId, currentQuantity: { gt: 0 } },
      orderBy: [{ productType: 'asc' }, { lotNumber: 'asc' }],
    });

    if (items.length === 0) return [];

    const findings: CloseFinding[] = [];

    const seeds = items.filter((i) => i.productType === 'SEEDS');
    if (seeds.length > 0) {
      findings.push({
        message: `Seeds: ${seeds.length} lot(s) still have a balance.`,
        details: seeds.map(
          (i) =>
            `${i.productName} · lot ${i.lotNumber} — ${formatQuantity(i.currentQuantity, i.productType)}`,
        ),
      });
    }

    const peat = items.filter((i) => i.productType === 'PEAT');
    if (peat.length > 0) {
      findings.push({
        message: `Peat: ${peat.length} lot(s) still have a balance.`,
        details: peat.map(
          (i) =>
            `${i.productName} · lot ${i.lotNumber} — ${formatQuantity(i.currentQuantity, i.productType)}`,
        ),
      });
    }

    // Crop protection and fertiliser are season-scoped too (`AgriInputSeason`),
    // and were the one balance the report never mentioned (SEASON-02).
    const inputs = await this.prismaService.agriInputSeason.findMany({
      where: { seasonId, currentQuantity: { gt: 0 } },
      select: {
        currentQuantity: true,
        product: { select: { name: true, unit: true } },
      },
      orderBy: { product: { name: 'asc' } },
    });

    if (inputs.length > 0) {
      findings.push({
        message: `Crop protection and fertiliser: ${inputs.length} product(s) still have a balance.`,
        details: inputs.map(
          (i) =>
            `${i.product.name} — ${i.currentQuantity.toLocaleString('en-GB')} ${i.product.unit}`,
        ),
      });
    }

    return findings;
  }

  /**
   * The one query behind the "leftover goods" block. Takes a client so the SAME
   * query runs inside the close transaction — what the admin saw in the preview
   * is what actually gates the close.
   */
  private findLeftovers(db: Db, seasonId: string) {
    return db.harvestedProduct.findMany({
      where: { seasonId, currentQuantity: { gt: 0 } },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Close a season — one transaction, all or nothing.
   *
   * Closing no longer forces the following season open: the administrator
   * chooses which season to open (or none) in the same action, so there is no
   * assumption that the next season is the one wanted.
   *
   * The following season is always created if it does not exist yet — as
   * CLOSED and ready to open — so "open the next one" is always a choice. It is
   * opened only when the administrator picks it.
   *
   * Copies NOTHING: a season starts with no tunnels, no sectors, no stock and
   * no plans. The admin re-enters those in the browser.
   *
   * When nothing is opened the app has no open season at all, and every new
   * record is refused until an administrator opens one — that is deliberate.
   *
   * @param open `"next"`, the id of a season to open, or `null` to open none.
   * @param actor who is closing — recorded as the creator of the season this
   *   close creates when it does not exist yet.
   */
  async close(
    seasonId: string,
    open: string | null,
    actor: Actor,
  ): Promise<CloseResult> {
    const target = open === '' ? null : open;

    if (target && target !== OPEN_NEXT && !UUID_PATTERN.test(target)) {
      throw new BadRequestException('Choose a season to open, or none.');
    }

    if (target === seasonId) {
      throw new BadRequestException(
        'That is the season being closed. Choose a different one, or none.',
      );
    }

    const result = await this.prismaService.$transaction(async (tx) => {
      const season = await tx.season.findUnique({
        where: { id: seasonId },
        select: { id: true, code: true, status: true },
      });

      if (!season) {
        throw new NotFoundException('This season no longer exists.');
      }

      if (season.status !== 'ACTIVE') {
        throw new ConflictException(
          `Season ${season.code} is not the open season, so it cannot be closed.`,
        );
      }

      const leftovers = await this.findLeftovers(tx, season.id);
      if (leftovers.length > 0) {
        const list = leftovers
          .map(
            (p) =>
              `${p.name} (code ${p.planteCode}), ${Math.floor(
                p.currentQuantity / p.plantsPerBox,
              )} boxes`,
          )
          .join('; ');

        throw new ConflictException(
          `Season ${season.code} cannot be closed: harvested plants are still in stock — ${list}. Ship them, or write them off, first.`,
        );
      }

      const closed = await tx.season.update({
        where: { id: season.id },
        data: { status: 'CLOSED', closedAt: new Date() },
        select: { id: true, code: true },
      });

      // The following season always exists after a close, ready to open — but
      // it is opened only when the administrator chooses it.
      const nextCode = nextSeasonCode(season.code);
      await tx.season.upsert({
        where: { code: nextCode },
        update: {},
        create: {
          code: nextCode,
          ...seasonBounds(startYearFromCode(nextCode)),
          status: 'CLOSED',
          createdBy: actor.id,
          createdByName: actor.name,
        },
        select: { id: true },
      });

      let opened: { id: string; code: string } | null = null;

      if (target) {
        const seasonToOpen =
          target === OPEN_NEXT
            ? await tx.season.findUnique({
                where: { code: nextCode },
                select: { id: true, code: true },
              })
            : await tx.season.findUnique({
                where: { id: target },
                select: { id: true, code: true },
              });

        if (!seasonToOpen) {
          throw new NotFoundException('That season no longer exists.');
        }

        opened = await tx.season.update({
          where: { id: seasonToOpen.id },
          data: { status: 'ACTIVE', activatedAt: new Date(), closedAt: null },
          select: { id: true, code: true },
        });
      }

      return { closed, opened };
    });

    // The open season is held in memory, so the swap that just happened in the
    // database must be picked up before the next request reads it.
    await this.seasonService.refreshActive();

    return result;
  }
}
