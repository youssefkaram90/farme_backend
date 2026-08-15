import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTunnelDto } from './dto/create-tunnel.dto';

@Injectable()
export class TunnelsService {
  constructor(private prismaService: PrismaService) {}

  async create(createTunnelDto: CreateTunnelDto) {
    const existing = await this.prismaService.tunnel.findUnique({
      where: { number: createTunnelDto.number },
    });

    if (existing) {
      throw new ConflictException(
        `Tunnel ${createTunnelDto.number} already exists`,
      );
    }

    return this.prismaService.tunnel.create({
      data: createTunnelDto,
    });
  }

  async findAll(q?: string) {
    const where = q
      ? {
          number: { contains: q, mode: 'insensitive' as const },
        }
      : {};

    return this.prismaService.tunnel.findMany({
      where,
      orderBy: { number: 'asc' },
      include: {
        _count: {
          select: { ssmSowings: true },
        },
      },
    });
  }

  async findOne(id: string) {
    const tunnel = await this.prismaService.tunnel.findUnique({
      where: { id },
      include: {
        ssmSowings: {
          orderBy: { sowingDate: 'desc' },
          include: { plantStock: true },
        },
      },
    });

    if (!tunnel) {
      throw new NotFoundException(`Tunnel with ID ${id} not found`);
    }

    return tunnel;
  }

  async update(id: string, updateTunnelDto: CreateTunnelDto) {
    await this.findOne(id); // throw if not found

    const existing = await this.prismaService.tunnel.findUnique({
      where: { number: updateTunnelDto.number },
    });

    if (existing && existing.id !== id) {
      throw new ConflictException(
        `Tunnel ${updateTunnelDto.number} already exists`,
      );
    }

    return this.prismaService.tunnel.update({
      where: { id },
      data: updateTunnelDto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prismaService.tunnel.delete({ where: { id } });
  }
}
