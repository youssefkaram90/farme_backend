import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSectorDto } from './dto/create-sector.dto';

@Injectable()
export class SectorsService {
  constructor(private prismaService: PrismaService) {}

  async create(createSectorDto: CreateSectorDto) {
    const existing = await this.prismaService.sector.findFirst({
      where: {
        name: createSectorDto.name,
        location: createSectorDto.location ?? null,
      },
    });

    if (existing) {
      throw new ConflictException(
        `Sector ${createSectorDto.name} already exists in this location`,
      );
    }

    return this.prismaService.sector.create({
      data: createSectorDto,
    });
  }

  async findAll(q?: string) {
    const where = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { location: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {};

    return this.prismaService.sector.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { lpmSowings: true },
        },
      },
    });
  }

  async findOne(id: string) {
    const sector = await this.prismaService.sector.findUnique({
      where: { id },
      include: {
        lpmSowings: {
          orderBy: { sowingDate: 'desc' },
          include: { plantStock: true },
        },
      },
    });

    if (!sector) {
      throw new NotFoundException(`Sector with ID ${id} not found`);
    }

    return sector;
  }

  async update(id: string, updateSectorDto: CreateSectorDto) {
    await this.findOne(id);

    const existing = await this.prismaService.sector.findFirst({
      where: {
        name: updateSectorDto.name,
        location: updateSectorDto.location ?? null,
        id: { not: id },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Sector ${updateSectorDto.name} already exists in this location`,
      );
    }

    return this.prismaService.sector.update({
      where: { id },
      data: updateSectorDto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prismaService.sector.delete({ where: { id } });
  }
}
