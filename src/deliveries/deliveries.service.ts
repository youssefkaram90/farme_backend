import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
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

      // Update stock for each lot — passing `tx` ensures the same transaction
      for (const lot of created.lots) {
        await this.stockService.addStock(
          {
            lotNumber: lot.lotNumber,
            productType: lot.productType,
            stockType,
            quantity: lot.quantity,
            referenceId: lot.id,
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
}
