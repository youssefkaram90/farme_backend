import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { StockService } from '../stock/stock.service';
import { ReferenceType } from '../stock/enums/reference-type.enum';
import { pooledLot } from '../stock/pooled-lot';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { getPaginationParams } from '../common/pagination';
import { ERROR_MESSAGES } from '../common/error-messages';
import { SeasonService } from '../season/season.service';
import type { Actor } from '../common/actor';

@Injectable()
export class DeliveriesService {
  constructor(
    private prismaService: PrismaService,
    private stockService: StockService,
    private seasonService: SeasonService,
  ) {}

  async create(createDeliveryDto: CreateDeliveryDto, actor: Actor) {
    const { deliveryCode, deliveryDate, transport, lots } = createDeliveryDto;

    // Convert date-only string to full ISO-8601 DateTime
    const deliveryDateISO = new Date(deliveryDate).toISOString();

    // A delivery dated outside the season it is filed into would skew that
    // season's numbers for good (SEASON-08).
    await this.seasonService.assertDateInSeason(
      new Date(deliveryDateISO),
      'delivery date',
    );

    // Use a transaction to ensure delivery creation + stock update are atomic
    const delivery = await this.prismaService.$transaction(async (tx) => {
      const created = await tx.delivery.create({
        data: {
          seasonId: this.seasonService.getActiveSeasonId(),
          deliveryCode,
          deliveryDate: deliveryDateISO,
          transport,
          lots: {
            create: lots.map((lot) => ({
              lotNumber: lot.lotNumber,
              // What the stock pool will actually use: for peat that is
              // 'GENERIC', not the client's BIO/CVT (DELIV-04), so the delivery
              // row and the ledger agree about the same lot.
              stockType: pooledLot({
                productType: lot.productType,
                lotNumber: lot.lotNumber,
                stockType: lot.stockType ?? '',
              }).stockType,
              quantity: lot.quantity,
              thousandSeedsPerGram: lot.thousandSeedsPerGram,
              productType: lot.productType,
              productName: lot.productName,
              supplierName: lot.supplierName,
              remark: lot.remark,
            })),
          },
        },
        include: { lots: true },
      });

      // Update stock for each lot — passing tx ensures the same transaction
      // Peat is pooled: all PEAT deliveries go into a single stock item
      for (const lot of created.lots) {
        await this.stockService.addStock(
          {
            ...pooledLot(lot),
            productType: lot.productType,
            quantity: lot.quantity,
            referenceId: lot.id,
            referenceType: ReferenceType.DELIVERY,
            productName: lot.productName,
            supplierName: lot.supplierName,
            createdByName: actor.name,
          },
          tx,
        );
      }

      return created;
    });

    return delivery;
  }

  async findAll(q?: string, page?: string, pageSize?: string) {
    const seasonId = this.seasonService.getActiveSeasonId();
    const where = q
      ? {
          seasonId,
          OR: [
            { deliveryCode: { contains: q, mode: 'insensitive' as const } },
            { transport: { contains: q, mode: 'insensitive' as const } },
            {
              lots: {
                some: {
                  OR: [
                    {
                      productName: {
                        contains: q,
                        mode: 'insensitive' as const,
                      },
                    },
                    {
                      lotNumber: { contains: q, mode: 'insensitive' as const },
                    },
                    {
                      supplierName: {
                        contains: q,
                        mode: 'insensitive' as const,
                      },
                    },
                    {
                      stockType: { contains: q, mode: 'insensitive' as const },
                    },
                    {
                      productType: {
                        contains: q,
                        mode: 'insensitive' as const,
                      },
                    },
                  ],
                },
              },
            },
          ],
        }
      : { seasonId };

    const pagination = getPaginationParams(page, pageSize);

    if (pagination) {
      const [total, items] = await Promise.all([
        this.prismaService.delivery.count({ where }),
        this.prismaService.delivery.findMany({
          where,
          include: { lots: true },
          orderBy: { createdAt: 'desc' },
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

    return this.prismaService.delivery.findMany({
      where,
      include: { lots: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const delivery = await this.prismaService.delivery.findUnique({
      where: { id },
      include: { lots: true },
    });

    if (!delivery) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    return delivery;
  }

  async update(id: string, updateDeliveryDto: CreateDeliveryDto, actor: Actor) {
    const { deliveryCode, deliveryDate, transport, lots } = updateDeliveryDto;

    // Convert date-only string to full ISO-8601 DateTime
    const deliveryDateISO = new Date(deliveryDate).toISOString();

    return this.prismaService.$transaction(async (tx) => {
      // Read INSIDE the transaction (DELIV-01). The lots that drive the reversal
      // used to be fetched before it began, so two requests arriving together
      // could both reverse the same quantities — and a wrong reversal is
      // permanent, because it puts stock back.
      const existing = await tx.delivery.findUnique({
        where: { id },
        include: { lots: true },
      });

      if (!existing) {
        throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
      }

      // Judged against the delivery's OWN season, not the open one: correcting a
      // closed season's date must not move it into another season (SEASON-08).
      await this.seasonService.assertDateInSeason(
        new Date(deliveryDateISO),
        'delivery date',
        existing.seasonId,
      );

      // Reverse old stock: put back what the existing lots added. Peat uses the
      // pooled lot number and stock type — see `pooledLot`.
      for (const lot of existing.lots) {
        await this.stockService.removeStock(
          {
            ...pooledLot(lot),
            productType: lot.productType,
            quantity: lot.quantity,
            referenceId: lot.id,
            referenceType: ReferenceType.DELIVERY,
            // The DELIVERY's own season, not the open one (DELIV-07): correcting
            // a closed season must not move the open season's stock.
            seasonId: existing.seasonId,
            createdByName: actor.name,
          },
          tx,
        );
      }

      // Delete old lots
      await tx.deliveryLot.deleteMany({ where: { deliveryId: id } });

      // Create new lots and update stock
      const updated = await tx.delivery.update({
        where: { id },
        data: {
          deliveryDate: deliveryDateISO,
          // These two were accepted and thrown away (DELIV-03): the edit form
          // sends the whole delivery, so the screen looked as though it had
          // saved them and reverted on the next load.
          deliveryCode,
          transport,
          lots: {
            create: lots.map((lot) => ({
              stockType: pooledLot({
                productType: lot.productType,
                lotNumber: lot.lotNumber,
                stockType: lot.stockType ?? '',
              }).stockType,
              lotNumber: lot.lotNumber,
              quantity: lot.quantity,
              thousandSeedsPerGram: lot.thousandSeedsPerGram,
              productType: lot.productType,
              productName: lot.productName,
              supplierName: lot.supplierName,
              remark: lot.remark,
            })),
          },
        },
        include: { lots: true },
      });

      for (const lot of updated.lots) {
        await this.stockService.addStock(
          {
            ...pooledLot(lot),
            productType: lot.productType,
            quantity: lot.quantity,
            referenceId: lot.id,
            referenceType: ReferenceType.DELIVERY,
            seasonId: existing.seasonId,
            productName: lot.productName,
            supplierName: lot.supplierName,
            createdByName: actor.name,
          },
          tx,
        );
      }

      return updated;
    });
  }

  /**
   * Has any of this delivery's stock been moved by something other than the
   * delivery itself?
   *
   * Deleting a delivery reverses its quantities by adding them back. If the seeds
   * have already been sown, that puts stock into the pool that does not
   * physically exist — and nothing afterwards says where it came from, because a
   * `StockMovement` points at a `StockItem`, not at a delivery lot: there is no
   * foreign key to follow (DELIV-02, the plain-language half of X-03 for
   * `Delivery`).
   *
   * So a delivery stops being deletable the moment its stock has been used, and
   * the sentence says what to do instead. Not a soft delete: "once used, it is
   * history".
   */
  private async assertStockUnused(
    tx: Prisma.TransactionClient,
    lots: {
      id: string;
      lotNumber: string;
      productType: string;
      stockType: string;
    }[],
    seasonId: string,
  ) {
    for (const lot of lots) {
      const stockItem = await tx.stockItem.findUnique({
        where: {
          seasonId_productType_stockType_lotNumber: {
            seasonId,
            productType: lot.productType,
            ...pooledLot(lot),
          },
        },
        select: { id: true },
      });

      if (!stockItem) continue;

      const used = await tx.stockMovement.count({
        where: {
          stockItemId: stockItem.id,
          NOT: { referenceType: ReferenceType.DELIVERY, referenceId: lot.id },
        },
      });

      if (used > 0) {
        throw new ConflictException(
          `Some of this delivery has already been used (lot ${lot.lotNumber}). It cannot be deleted — correct the quantities, or record a stock adjustment instead.`,
        );
      }
    }
  }

  async remove(id: string, actor: Actor) {
    return this.prismaService.$transaction(async (tx) => {
      // Inside the transaction, for the same reason as `update` (DELIV-01).
      const existing = await tx.delivery.findUnique({
        where: { id },
        include: { lots: true },
      });

      if (!existing) {
        throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
      }

      await this.assertStockUnused(tx, existing.lots, existing.seasonId);

      // Reverse stock for each lot. Peat uses the pooled lot number and stock
      // type — see `pooledLot`.
      for (const lot of existing.lots) {
        await this.stockService.removeStock(
          {
            ...pooledLot(lot),
            productType: lot.productType,
            quantity: lot.quantity,
            referenceId: lot.id,
            referenceType: ReferenceType.DELIVERY,
            seasonId: existing.seasonId,
            createdByName: actor.name,
          },
          tx,
        );
      }

      // Deletes the delivery and its lots. The `StockMovement` rows STAY: they are
      // the ledger, and the reversal above has already recorded what happened.
      // The comment here used to claim the delete cascaded to them — it cannot,
      // because `StockMovement` has no foreign key to a delivery lot (DELIV-02).
      await tx.delivery.delete({ where: { id } });

      return { message: 'Delivery deleted successfully' };
    });
  }
}
