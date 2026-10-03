import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { ReferenceType } from './enums/reference-type.enum';
import { MovementReason } from '../common/enums/movement-reason.enum';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import type { Actor } from '../common/actor';
import { getPaginationParams } from '../common/pagination';
import { ERROR_MESSAGES } from '../common/error-messages';
import { SeasonService } from '../season/season.service';

/** Subset of Prisma.TransactionClient with only the model accessors */
type TxClient = Prisma.TransactionClient;

@Injectable()
export class StockService {
  constructor(
    private prismaService: PrismaService,
    private seasonService: SeasonService,
  ) {}

  /**
   * Add stock (positive quantity) - called when a delivery is created.
   * Creates the StockItem if it doesn't exist, otherwise increments.
   *
   * When no external transaction is provided, the upsert and movement creation
   * are wrapped in an internal transaction so that a failure between the two
   * writes rolls back the quantity change, keeping stock and audit in sync.
   *
   * @param tx - Optional transaction client. If provided, operations run inside the caller's transaction.
   */
  async addStock(
    params: {
      lotNumber: string;
      productType: string;
      stockType: string;
      quantity: number;
      referenceId?: string;
      referenceType: ReferenceType;
      productName?: string;
      supplierName?: string;
      /**
       * Which season's pool to move. Defaults to the open season, which is right
       * for anything being recorded now.
       *
       * Pass it explicitly when correcting a record that belongs to a CLOSED
       * season (DELIV-07): resolving the pool from the open season instead would
       * take the quantities out of the wrong season — one season's stock changing
       * because of another season's edit, which is exactly what the closed-season
       * rule exists to prevent.
       */
      seasonId?: string;
      /**
       * Who caused it — the user's NAME, so the ledger reads on screen and is
       * never blank. Required, not optional: a movement without an actor is
       * the thing this whole column exists to prevent.
       */
      createdByName: string;
    },
    tx?: TxClient,
  ) {
    const {
      lotNumber,
      productType,
      stockType,
      quantity,
      referenceId,
      referenceType,
      productName,
      supplierName,
      createdByName,
    } = params;

    if (quantity <= 0) {
      throw new BadRequestException('Quantity must be positive');
    }

    const seasonId = params.seasonId ?? this.seasonService.getActiveSeasonId();

    const execute = async (c: TxClient | typeof this.prismaService) => {
      const stockItem = await c.stockItem.upsert({
        where: {
          seasonId_productType_stockType_lotNumber: {
            seasonId,
            productType,
            stockType,
            lotNumber,
          },
        },
        // The names are set when the pool is created and never touched again
        // (decided 2026-10-01, STOCK-05). The pool is keyed by season + product
        // type + stock type + lot number — not by product name or supplier — so
        // two deliveries can share a row while disagreeing about both, and
        // letting the newest win silently relabelled stock that movements from
        // earlier deliveries were already booked against. Nor can the name be
        // left blank: `productName` and `supplierName` are required on a lot.
        update: {
          currentQuantity: { increment: quantity },
        },
        create: {
          seasonId,
          productType,
          stockType,
          lotNumber,
          productName: productName ?? '',
          supplierName: supplierName ?? '',
          currentQuantity: quantity,
        },
      });

      await c.stockMovement.create({
        data: {
          stockItemId: stockItem.id,
          quantity,
          referenceType,
          referenceId,
          createdByName,
        },
      });

      return stockItem;
    };

    if (!tx) {
      return this.prismaService.$transaction((c) => execute(c));
    }

    return execute(tx);
  }

  /**
   * Remove stock (negative quantity) - called when sowing is created.
   * Decrements stock and records a movement. Negative stock is allowed.
   *
   * @param tx - Optional transaction client. If provided, operations run inside the caller's transaction.
   */
  async removeStock(
    params: {
      lotNumber: string;
      productType: string;
      stockType: string;
      quantity: number;
      referenceId?: string;
      referenceType: ReferenceType;
      /** Which season's pool to move — see `addStock`. */
      seasonId?: string;
      /** Who caused it — see `addStock`. */
      createdByName: string;
    },
    tx?: TxClient,
  ) {
    const {
      lotNumber,
      productType,
      stockType,
      quantity,
      referenceId,
      referenceType,
      createdByName,
    } = params;

    if (quantity <= 0) {
      throw new BadRequestException('Quantity must be positive');
    }

    const seasonId = params.seasonId ?? this.seasonService.getActiveSeasonId();

    const execute = async (c: TxClient | typeof this.prismaService) => {
      const stockItem = await c.stockItem.findUnique({
        where: {
          seasonId_productType_stockType_lotNumber: {
            seasonId,
            productType,
            stockType,
            lotNumber,
          },
        },
      });

      if (!stockItem) {
        throw new NotFoundException(
          'No stock is available for the selected lot.',
        );
      }

      const updated = await c.stockItem.update({
        where: { id: stockItem.id },
        data: {
          currentQuantity: { decrement: quantity },
        },
      });

      await c.stockMovement.create({
        data: {
          stockItemId: stockItem.id,
          quantity: -quantity,
          referenceType,
          referenceId,
          createdByName,
        },
      });

      return updated;
    };

    // One spelling of "run inside the caller's transaction, or open one" for
    // both helpers — this used to recurse into itself while `addStock` closed
    // over a local `execute` (STOCK-05).
    if (!tx) {
      return this.prismaService.$transaction((c) => execute(c));
    }

    return execute(tx);
  }

  /**
   * Record a movement a person made by hand — an opening balance, a return, a
   * write-off or a correction.
   *
   * Unlike a sowing (which is allowed to overrun into negative stock, because
   * you may sow before the delivery is recorded), an adjustment that would take
   * the pool below zero is refused: after a manual entry that is nearly always
   * a typo. The check runs INSIDE the transaction, so a refusal rolls the
   * quantity change back on its own.
   */
  async adjustStock(dto: AdjustStockDto, actor: Actor) {
    const item = await this.prismaService.stockItem.findUnique({
      where: { id: dto.stockItemId },
    });

    if (!item) {
      throw new NotFoundException('This stock lot no longer exists.');
    }

    if (dto.quantity === 0) {
      throw new BadRequestException('Enter a quantity.');
    }

    // P7-12: the reason enum is shared with agri-inputs, so two of its values
    // mean nothing here — and the DTO alone cannot tell the difference. Both are
    // refused with the same sentences agri-inputs uses, so the same mistake reads
    // the same way wherever it is made.
    if (dto.reason === MovementReason.USED) {
      throw new BadRequestException(
        'What was used is recorded when a treatment is logged, not by hand.',
      );
    }

    if (dto.reason === MovementReason.RECEIVED) {
      throw new BadRequestException(
        'Seeds and peat arrive on a delivery — record the delivery instead.',
      );
    }

    const removesStock =
      dto.reason === MovementReason.RETURNED_TO_CLIENT ||
      dto.reason === MovementReason.WASTE;

    if (removesStock && dto.quantity > 0) {
      throw new BadRequestException(
        'That reason can only be used to take stock out, not add it.',
      );
    }

    if (dto.reason === MovementReason.OPENING && dto.quantity < 0) {
      throw new BadRequestException(
        'An opening balance must be a positive quantity.',
      );
    }

    return this.prismaService.$transaction(async (tx) => {
      const updated = await tx.stockItem.update({
        where: { id: item.id },
        data: { currentQuantity: { increment: dto.quantity } },
      });

      if (updated.currentQuantity < 0) {
        // The number to quote is what was available when the person tried: read
        // from the row this transaction has just changed, not from the copy
        // fetched before it started, which another movement may have moved on
        // since (STOCK-02).
        const available = updated.currentQuantity - dto.quantity;

        throw new BadRequestException(
          available > 0
            ? `Only ${available.toLocaleString('en-GB')} of lot ${item.lotNumber} is left.`
            : `Lot ${item.lotNumber} has nothing left to take from — it is already at ${available.toLocaleString('en-GB')}.`,
        );
      }

      await tx.stockMovement.create({
        data: {
          stockItemId: item.id,
          quantity: dto.quantity,
          referenceType: ReferenceType.MANUAL,
          reason: dto.reason,
          note: dto.note ?? null,
          createdByName: actor.name,
        },
      });

      return updated;
    });
  }

  async findAll(q?: string, page?: string, pageSize?: string) {
    const seasonId = this.seasonService.getActiveSeasonId();
    const where = q
      ? {
          seasonId,
          OR: [
            { productName: { contains: q, mode: 'insensitive' as const } },
            { lotNumber: { contains: q, mode: 'insensitive' as const } },
            { supplierName: { contains: q, mode: 'insensitive' as const } },
            { productType: { contains: q, mode: 'insensitive' as const } },
            { stockType: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : { seasonId };

    const pagination = getPaginationParams(page, pageSize);

    if (pagination) {
      const [total, items] = await Promise.all([
        this.prismaService.stockItem.count({ where }),
        this.prismaService.stockItem.findMany({
          where,
          orderBy: [{ productType: 'asc' }, { lotNumber: 'asc' }],
          skip: pagination.skip,
          take: pagination.take,
        }),
      ]);

      return {
        items,
        total,
        page: pagination.page,
        pageSize: pagination.pageSize,
        hasMore: pagination.page * pagination.pageSize < total,
      };
    }

    return this.prismaService.stockItem.findMany({
      where,
      orderBy: [{ productType: 'asc' }, { lotNumber: 'asc' }],
    });
  }

  async findOne(id: string) {
    const item = await this.prismaService.stockItem.findUnique({
      where: { id },
      include: {
        movements: {
          orderBy: { createdAt: 'desc' },
        },
        // The lot's own season, not the open one: a lot is never carried across
        // seasons, so this is the season every movement below belongs to.
        season: { select: { code: true } },
      },
    });

    if (!item) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    return item;
  }

  /**
   * Every movement of one lot — the lot's whole story, newest first.
   *
   * Deliberately unpaginated (decided 2026-10-01, STOCK-04): a lot belongs to a
   * single season and this is the history panel of one lot's page, so it is
   * bounded in practice. Revisit if a pooled lot (all PEAT lives in one) ever
   * grows past a few hundred rows.
   */
  async getMovements(stockItemId: string) {
    return this.prismaService.stockMovement.findMany({
      where: { stockItemId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSummary() {
    const items = await this.prismaService.stockItem.findMany({
      where: { seasonId: this.seasonService.getActiveSeasonId() },
    });
    const summary = {
      SEEDS: { totalQuantity: 0, lots: 0 },
      PEAT: { totalQuantity: 0, lots: 0 },
    } as Record<string, { totalQuantity: number; lots: number }>;

    for (const item of items) {
      if (!summary[item.productType]) {
        summary[item.productType] = { totalQuantity: 0, lots: 0 };
      }
      summary[item.productType].totalQuantity += item.currentQuantity;
      summary[item.productType].lots += 1;
    }

    return summary;
  }
}
