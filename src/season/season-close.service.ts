import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlantStockService } from '../plant-stock/plant-stock.service';
import { Prisma } from '../generated/prisma/client';
import { SeasonService } from './season.service';
import {
  formatSeasonDate,
  nextSeasonCode,
  seasonBounds,
  startYearFromCode,
} from '../common/season-code';

/** Either the plain client or a transaction client — the checks accept both. */
type Db = PrismaService | Prisma.TransactionClient;

/** One finding in the close report. */
export type CloseFinding = {
  /** One plain sentence for the user. */
  message: string;
  /** Per-item lines, e.g. one per leftover product. */
  details: string[];
};

export type ClosePreview = {
  season: { id: string; code: string };
  /** While this is non-empty the close is refused. */
  blocks: CloseFinding[];
  /** Shown for acknowledgement; the close may still go ahead. */
  warnings: CloseFinding[];
  /** Read-only context, e.g. the closing stock balances. */
  info: CloseFinding[];
  canClose: boolean;
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

    const [blocks, warningGroups, info, incompleteShipments] =
      await Promise.all([
        this.findLeftoverGoods(season.id),
        this.findStandingThings(season.id),
        this.findClosingStockBalances(season.id),
        this.findIncompleteShipments(season.id),
      ]);

    return {
      season: { id: season.id, code: season.code },
      blocks,
      // The unfinished-record warning joins the standing-things ones: both are
      // things to look at, neither stops the close (SEASON-02).
      warnings: [...warningGroups, ...incompleteShipments],
      info,
      canClose: blocks.length === 0,
    };
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
            `${i.productName} · lot ${i.lotNumber} — ${i.currentQuantity.toLocaleString('en-GB')}`,
        ),
      });
    }

    const peat = items.filter((i) => i.productType === 'PEAT');
    if (peat.length > 0) {
      findings.push({
        message: `Peat: ${peat.length} lot(s) still have a balance.`,
        details: peat.map(
          (i) =>
            `${i.productName} · lot ${i.lotNumber} — ${i.currentQuantity.toFixed(2)}`,
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
   * Close a season and open the next one — one transaction, all or nothing.
   *
   * Copies NOTHING: the new season starts with no tunnels, no sectors, no
   * stock and no plans. The admin re-enters those in the browser.
   */
  async close(seasonId: string) {
    const opened = await this.prismaService.$transaction(async (tx) => {
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

      const nextCode = nextSeasonCode(season.code);

      const alreadyExists = await tx.season.findUnique({
        where: { code: nextCode },
        select: { id: true },
      });

      if (alreadyExists) {
        throw new ConflictException(
          `Season ${nextCode} already exists, so ${season.code} cannot be closed into it. Please check the seasons.`,
        );
      }

      await tx.season.update({
        where: { id: season.id },
        data: { status: 'CLOSED', closedAt: new Date() },
      });

      return tx.season.create({
        data: {
          code: nextCode,
          ...seasonBounds(startYearFromCode(nextCode)),
          status: 'ACTIVE',
          activatedAt: new Date(),
        },
      });
    });

    // The open season is held in memory, so the swap that just happened in the
    // database must be picked up before the next request reads it.
    await this.seasonService.refreshActive();

    return opened;
  }
}
