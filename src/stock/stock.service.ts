import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { ReferenceType } from './enums/reference-type.enum';

/** Subset of Prisma.TransactionClient with only the model accessors */
type TxClient = Prisma.TransactionClient;

@Injectable()
export class StockService {
  constructor(private prismaService: PrismaService) {}

  /**
   * Add stock (positive quantity) — called when a delivery is created.
   * Creates the StockItem if it doesn't exist, otherwise increments.
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
    },
    tx?: TxClient,
  ) {
    const { lotNumber, productType, stockType, quantity, referenceId } = params;

    if (quantity <= 0) {
      throw new BadRequestException('Quantity must be positive');
    }

    // Use the provided transaction client, or create a standalone one
    const client = tx ?? this.prismaService;

    // Upsert: create stock item if not exists, otherwise update quantity
    const stockItem = await client.stockItem.upsert({
      where: {
        productType_stockType_lotNumber: {
          productType,
          stockType,
          lotNumber,
        },
      },
      update: {
        currentQuantity: { increment: quantity },
      },
      create: {
        productType,
        stockType,
        lotNumber,
        currentQuantity: quantity,
      },
    });

    // Record the movement
    await client.stockMovement.create({
      data: {
        stockItemId: stockItem.id,
        quantity,
        referenceType: ReferenceType.DELIVERY,
        referenceId,
      },
    });

    return stockItem;
  }

  /**
   * Remove stock (negative quantity) — called when sowing is created.
   * Validates that sufficient stock exists.
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
    },
    tx?: TxClient,
  ) {
    const { lotNumber, productType, stockType, quantity, referenceId } = params;

    if (quantity <= 0) {
      throw new BadRequestException('Quantity must be positive');
    }

    // Use the provided transaction client, or create a standalone one
    const client = tx ?? this.prismaService;

    const stockItem = await client.stockItem.findUnique({
      where: {
        productType_stockType_lotNumber: {
          productType,
          stockType,
          lotNumber,
        },
      },
    });

    if (!stockItem) {
      throw new NotFoundException(
        `Stock item not found for lot ${lotNumber}, ${productType}, ${stockType}`,
      );
    }

    if (stockItem.currentQuantity < quantity) {
      throw new BadRequestException(
        `Insufficient stock. Available: ${stockItem.currentQuantity}, requested: ${quantity}`,
      );
    }

    const updated = await client.stockItem.update({
      where: { id: stockItem.id },
      data: {
        currentQuantity: { decrement: quantity },
      },
    });

    // Record the movement
    await client.stockMovement.create({
      data: {
        stockItemId: stockItem.id,
        quantity: -quantity,
        referenceType: ReferenceType.SOWING,
        referenceId,
      },
    });

    return updated;
  }

  /** Get all stock items with current quantities */
  async findAll() {
    return this.prismaService.stockItem.findMany({
      orderBy: [{ productType: 'asc' }, { lotNumber: 'asc' }],
    });
  }

  /** Get a single stock item by ID */
  async findOne(id: string) {
    const item = await this.prismaService.stockItem.findUnique({
      where: { id },
      include: {
        movements: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!item) {
      throw new NotFoundException(`Stock item with ID ${id} not found`);
    }

    return item;
  }

  /** Get movements for a specific stock item */
  async getMovements(stockItemId: string) {
    return this.prismaService.stockMovement.findMany({
      where: { stockItemId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Get stock summary grouped by product type */
  async getSummary() {
    const items = await this.prismaService.stockItem.findMany();
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
