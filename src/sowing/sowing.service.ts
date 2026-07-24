import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { ReferenceType } from '../stock/enums/reference-type.enum';
import { CreateSowingDto } from './dto/create-sowing.dto';

const DEFAULT_SEEDS_PER_TRAY = 285;

@Injectable()
export class SowingService {
  constructor(
    private prismaService: PrismaService,
    private stockService: StockService,
  ) {}

  async create(createSowingDto: CreateSowingDto) {
    const {
      variety,
      sowingDate,
      sowingType,
      lotNumber,
      productType,
      stockType,
      quantityUsed,
      numberOfTrays,
      seedsPerTray,
      remarks,
    } = createSowingDto;

    // Use a transaction to ensure stock deduction + sowing creation are atomic
    return this.prismaService.$transaction(async (tx) => {
      // 1. Calculate actual seeds used
      let actualQuantityUsed = quantityUsed;
      let actualNumberOfTrays: number | null = null;
      let actualSeedsPerTray: number | null = null;

      if (sowingType === 'SSM') {
        const nTrays = numberOfTrays ?? quantityUsed;
        const sPerTray = seedsPerTray ?? DEFAULT_SEEDS_PER_TRAY;
        actualNumberOfTrays = nTrays;
        actualSeedsPerTray = sPerTray;
        actualQuantityUsed = nTrays * sPerTray;
      }

      // 2. Create the sowing record
      const sowing = await tx.sowing.create({
        data: {
          variety,
          sowingDate,
          sowingType,
          lotNumber,
          productType,
          stockType,
          quantityUsed: actualQuantityUsed,
          numberOfTrays: actualNumberOfTrays,
          seedsPerTray: actualSeedsPerTray,
          remarks,
        },
      });

      // 3. Deduct stock and record movement — passing tx ensures the same transaction
      await this.stockService.removeStock(
        {
          lotNumber,
          productType,
          stockType,
          quantity: actualQuantityUsed,
          referenceId: sowing.id,
          referenceType: ReferenceType.SOWING,
        },
        tx,
      );

      // 4. Create plant stock record
      const expectedPlants = actualNumberOfTrays
        ? actualNumberOfTrays * actualSeedsPerTray!
        : actualQuantityUsed;

      await tx.plantStock.create({
        data: {
          sowingId: sowing.id,
          variety,
          location: sowingType,
          lotNumber,
          stockType,
          numberOfTrays: actualNumberOfTrays,
          seedsPerTray: actualSeedsPerTray,
          expectedPlants,
          currentStage: 'SEEDLING',
        },
      });

      return tx.sowing.findUnique({
        where: { id: sowing.id },
        include: { plantStock: true },
      });
    });
  }

  async findAll() {
    return this.prismaService.sowing.findMany({
      orderBy: { createdAt: 'desc' },
      include: { plantStock: true },
    });
  }

  async findOne(id: string) {
    return this.prismaService.sowing.findUnique({
      where: { id },
      include: { plantStock: true },
    });
  }

  async update(id: string, updateSowingDto: CreateSowingDto) {
    const existing = await this.prismaService.sowing.findUnique({
      where: { id },
      include: { plantStock: true },
    });

    if (!existing) {
      throw new NotFoundException(`Sowing with ID ${id} not found`);
    }

    const {
      variety,
      sowingDate,
      sowingType,
      lotNumber,
      productType,
      stockType,
      quantityUsed,
      numberOfTrays,
      seedsPerTray,
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
          referenceType: ReferenceType.SOWING,
        },
        tx,
      );

      // Calculate new seeds used
      let actualQuantityUsed = quantityUsed;
      let actualNumberOfTrays: number | null = null;
      let actualSeedsPerTray: number | null = null;

      if (sowingType === 'SSM') {
        const nTrays = numberOfTrays ?? quantityUsed;
        const sPerTray = seedsPerTray ?? DEFAULT_SEEDS_PER_TRAY;
        actualNumberOfTrays = nTrays;
        actualSeedsPerTray = sPerTray;
        actualQuantityUsed = nTrays * sPerTray;
      }

      // Apply new stock deduction
      await this.stockService.removeStock(
        {
          lotNumber,
          productType,
          stockType,
          quantity: actualQuantityUsed,
          referenceId: id,
          referenceType: ReferenceType.SOWING,
        },
        tx,
      );

      // Update sowing record
      await tx.sowing.update({
        where: { id },
        data: {
          variety,
          sowingDate,
          sowingType,
          lotNumber,
          productType,
          stockType,
          quantityUsed: actualQuantityUsed,
          numberOfTrays: actualNumberOfTrays,
          seedsPerTray: actualSeedsPerTray,
          remarks,
        },
      });

      // Update plant stock
      const expectedPlants = actualNumberOfTrays
        ? actualNumberOfTrays * actualSeedsPerTray!
        : actualQuantityUsed;

      if (existing.plantStock) {
        await tx.plantStock.update({
          where: { sowingId: id },
          data: {
            variety,
            location: sowingType,
            lotNumber,
            stockType,
            numberOfTrays: actualNumberOfTrays,
            seedsPerTray: actualSeedsPerTray,
            expectedPlants,
          },
        });
      } else {
        await tx.plantStock.create({
          data: {
            sowingId: id,
            variety,
            location: sowingType,
            lotNumber,
            stockType,
            numberOfTrays: actualNumberOfTrays,
            seedsPerTray: actualSeedsPerTray,
            expectedPlants,
            currentStage: 'SEEDLING',
          },
        });
      }

      return tx.sowing.findUnique({
        where: { id },
        include: { plantStock: true },
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
      // Delete plant stock (cascade will handle this, but do it explicitly)
      await tx.plantStock.deleteMany({ where: { sowingId: id } });

      // Reverse the stock deduction
      await this.stockService.addStock(
        {
          lotNumber: existing.lotNumber,
          productType: existing.productType,
          stockType: existing.stockType,
          quantity: existing.quantityUsed,
          referenceId: existing.id,
          referenceType: ReferenceType.SOWING,
        },
        tx,
      );

      // Delete sowing
      await tx.sowing.delete({ where: { id } });

      return { message: 'Sowing deleted successfully' };
    });
  }
}
