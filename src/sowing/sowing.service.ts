import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { CreateSowingDto } from './dto/create-sowing.dto';

@Injectable()
export class SowingService {
  constructor(
    private prismaService: PrismaService,
    private stockService: StockService,
  ) {}

  async create(createSowingDto: CreateSowingDto) {
    const {
      cropType,
      sowingDate,
      greenhouse,
      lotNumber,
      productType,
      stockType,
      quantityUsed,
      remarks,
    } = createSowingDto;

    // Use a transaction to ensure stock deduction + sowing creation are atomic
    return this.prismaService.$transaction(async (tx) => {
      // 1. Create the sowing record
      const sowing = await tx.sowing.create({
        data: {
          cropType,
          sowingDate,
          greenhouse,
          lotNumber,
          productType,
          stockType,
          quantityUsed,
          remarks,
        },
      });

      // 2. Deduct stock and record movement — passing tx ensures the same transaction
      await this.stockService.removeStock(
        {
          lotNumber,
          productType,
          stockType,
          quantity: quantityUsed,
          referenceId: sowing.id,
        },
        tx,
      );

      return sowing;
    });
  }

  async findAll() {
    return this.prismaService.sowing.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    return this.prismaService.sowing.findUnique({
      where: { id },
    });
  }

  async update(id: string, updateSowingDto: CreateSowingDto) {
    const existing = await this.prismaService.sowing.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Sowing with ID ${id} not found`);
    }

    const {
      cropType,
      sowingDate,
      greenhouse,
      lotNumber,
      productType,
      stockType,
      quantityUsed,
      remarks,
    } = updateSowingDto;

    return this.prismaService.$transaction(async (tx) => {
      // Reverse old stock deduction
      await this.stockService.addStock(
        {
          lotNumber: existing.lotNumber,
          productType: existing.productType,
          stockType: existing.stockType,
          quantity: existing.quantityUsed,
          referenceId: existing.id,
        },
        tx,
      );

      // Apply new stock deduction
      await this.stockService.removeStock(
        {
          lotNumber,
          productType,
          stockType,
          quantity: quantityUsed,
          referenceId: id,
        },
        tx,
      );

      // Update sowing record
      return tx.sowing.update({
        where: { id },
        data: {
          cropType,
          sowingDate,
          greenhouse,
          lotNumber,
          productType,
          stockType,
          quantityUsed,
          remarks,
        },
      });
    });
  }

  async remove(id: string) {
    const existing = await this.prismaService.sowing.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Sowing with ID ${id} not found`);
    }

    return this.prismaService.$transaction(async (tx) => {
      // Reverse the stock deduction
      await this.stockService.addStock(
        {
          lotNumber: existing.lotNumber,
          productType: existing.productType,
          stockType: existing.stockType,
          quantity: existing.quantityUsed,
          referenceId: existing.id,
        },
        tx,
      );

      // Delete sowing
      await tx.sowing.delete({ where: { id } });

      return { message: 'Sowing deleted successfully' };
    });
  }
}
