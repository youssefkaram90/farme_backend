import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { ReferenceType } from '../stock/enums/reference-type.enum';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { Prisma } from '../generated/prisma/client';

/** Subset of Prisma.TransactionClient with only the model accessors */
type TxClient = Prisma.TransactionClient;

@Injectable()
export class DeliveriesService {
  constructor(
    private prismaService: PrismaService,
    private stockService: StockService,
  ) {}

  async create(createDeliveryDto: CreateDeliveryDto) {
    const { stockType, lots } = createDeliveryDto;

    // Use a transaction to ensure delivery creation + stock update are atomic
    const delivery = await this.prismaService.$transaction(async (tx) => {
      const created = await tx.delivery.create({
        data: {
          stockType,
          lots: {
            create: lots.map((lot) => ({
              lotNumber: lot.lotNumber,
              quantity: lot.quantity,
              thousandSeedsPerGram: lot.thousandSeedsPerGram,
              productType: lot.productType,
              supplierName: lot.supplierName,
              remark: lot.remark,
            })),
          },
        },
        include: { lots: true },
      });

      // Update stock for each lot — passing tx ensures the same transaction
      for (const lot of created.lots) {
        await this.stockService.addStock(
          {
            lotNumber: lot.lotNumber,
            productType: lot.productType,
            stockType,
            quantity: lot.quantity,
            referenceId: lot.id,
            referenceType: ReferenceType.DELIVERY,
          },
          tx,
        );
      }

      return created;
    });

    return delivery;
  }

  async findAll() {
    return this.prismaService.delivery.findMany({
      include: { lots: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    return this.prismaService.delivery.findUnique({
      where: { id },
      include: { lots: true },
    });
  }

  async update(id: string, updateDeliveryDto: CreateDeliveryDto) {
    const existing = await this.prismaService.delivery.findUnique({
      where: { id },
      include: { lots: true },
    });

    if (!existing) {
      throw new NotFoundException(`Delivery with ID ${id} not found`);
    }

    const { stockType, lots } = updateDeliveryDto;

    return this.prismaService.$transaction(async (tx) => {
      // Reverse old stock: remove stock for each existing lot
      for (const lot of existing.lots) {
        await this.stockService.removeStock(
          {
            lotNumber: lot.lotNumber,
            productType: lot.productType,
            stockType: existing.stockType,
            quantity: lot.quantity,
            referenceId: lot.id,
            referenceType: ReferenceType.DELIVERY,
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
          stockType,
          lots: {
            create: lots.map((lot) => ({
              lotNumber: lot.lotNumber,
              quantity: lot.quantity,
              thousandSeedsPerGram: lot.thousandSeedsPerGram,
              productType: lot.productType,
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
            lotNumber: lot.lotNumber,
            productType: lot.productType,
            stockType,
            quantity: lot.quantity,
            referenceId: lot.id,
            referenceType: ReferenceType.DELIVERY,
          },
          tx,
        );
      }

      return updated;
    });
  }

  async remove(id: string) {
    const existing = await this.prismaService.delivery.findUnique({
      where: { id },
      include: { lots: true },
    });

    if (!existing) {
      throw new NotFoundException(`Delivery with ID ${id} not found`);
    }

    return this.prismaService.$transaction(async (tx) => {
      // Reverse stock for each lot
      for (const lot of existing.lots) {
        await this.stockService.removeStock(
          {
            lotNumber: lot.lotNumber,
            productType: lot.productType,
            stockType: existing.stockType,
            quantity: lot.quantity,
            referenceId: lot.id,
            referenceType: ReferenceType.DELIVERY,
          },
          tx,
        );
      }

      // Delete delivery (cascades to lots and stock movements)
      await tx.delivery.delete({ where: { id } });

      return { message: 'Delivery deleted successfully' };
    });
  }
}
