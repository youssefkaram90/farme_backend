import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdatePlantStockDto } from './dto/update-plant-stock.dto';
import { CreatePlantCountDto } from './dto/create-plant-count.dto';

@Injectable()
export class PlantStockService {
  constructor(private prismaService: PrismaService) {}

  async findAll(q?: string, stage?: string) {
    const where: Record<string, unknown> = {};

    if (q) {
      where.OR = [
        { variety: { contains: q, mode: 'insensitive' as const } },
        { location: { contains: q, mode: 'insensitive' as const } },
        { lotNumber: { contains: q, mode: 'insensitive' as const } },
      ];
    }

    if (stage) {
      where.currentStage = stage;
    }

    const items = await this.prismaService.plantStock.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        counts: { orderBy: { createdAt: 'desc' }, take: 1 },
        ssmSowing: {
          include: { tunnelAssignments: { include: { tunnel: true } } },
        },
      },
    });

    // SSM batches are split per tunnel (tray-transport). Each tunnel gets its own
    // entry with trays, seeds and expected plants proportional to what's in it.
    const rows: any[] = [];
    for (const ps of items) {
      if (ps.ssmSowingId && ps.ssmSowing) {
        const assignments = ps.ssmSowing.tunnelAssignments ?? [];
        if (assignments.length === 0) {
          // not transported yet → planned location, full batch, flagged
          rows.push({
            ...ps,
            inTunnel: null,
          });
        } else {
          for (const a of assignments) {
            const trays = a.numberOfTrays;
            const seedsPerTray = ps.seedsPerTray ?? 0;
            rows.push({
              ...ps,
              location: a.tunnel?.number ?? ps.location,
              numberOfTrays: trays,
              seedsSown: trays * seedsPerTray,
              expectedPlants: trays * seedsPerTray,
              inTunnel: trays,
            });
          }
        }
      } else {
        rows.push({ ...ps, inTunnel: null });
      }
    }

    return rows;
  }

  async findOne(id: string) {
    const plantStock = await this.prismaService.plantStock.findUnique({
      where: { id },
      include: {
        ssmSowing: {
          include: {
            tunnel: true,
            tunnelAssignments: { include: { tunnel: true } },
          },
        },
        lpmSowing: { include: { sector: true } },
        counts: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!plantStock) {
      throw new NotFoundException(`Plant stock with ID ${id} not found`);
    }

    return { ...plantStock, inTunnel: this.computeInTunnel(plantStock) };
  }

  /**
   * What is ACTUALLY in the location (tunnel):
   * sum of the tray-transport assignments for this sowing in that tunnel.
   * (numberOfTrays on the plant stock = whole sowing batch, not what's placed.)
   */
  private computeInTunnel(
    ps: {
      location: string;
      ssmSowing?: {
        tunnelAssignments?: {
          numberOfTrays: number;
          tunnel?: { number: string | null } | null;
        }[];
      } | null;
    } | null,
  ): number | null {
    const assignments = ps?.ssmSowing?.tunnelAssignments;
    if (!assignments || assignments.length === 0) return null;

    const matched = assignments.filter((a) => a.tunnel?.number === ps.location);
    const source = matched.length > 0 ? matched : assignments;

    return source.reduce((sum, a) => sum + a.numberOfTrays, 0);
  }

  async update(id: string, dto: UpdatePlantStockDto) {
    await this.findOne(id);

    return this.prismaService.plantStock.update({
      where: { id },
      data: dto,
    });
  }

  /**
   * Sample-based counting:
   *  - SSM (TRAY): user counts N trays → density = plants/tray → est = density × total trays
   *  - LPM (METER): user counts N meters → density = plants/meter → est = density × (lines × m/line)
   * Germination = estimatedPlants / seedsSown × 100
   */
  async createCount(id: string, dto: CreatePlantCountDto) {
    const plantStock = await this.prismaService.plantStock.findUnique({
      where: { id },
    });

    if (!plantStock) {
      throw new NotFoundException(`Plant stock with ID ${id} not found`);
    }

    const density = dto.countedPlants / dto.sampleSize;

    let estimatedPlants = 0;
    if (dto.countType === 'TRAY') {
      const trays = plantStock.numberOfTrays ?? 0;
      estimatedPlants = Math.round(density * trays);
    } else {
      const linesNum = parseFloat((plantStock.lines || '0').replace(',', '.'));
      const mpl = plantStock.metersPerLine ?? 0;
      const totalMeters = linesNum * mpl;
      estimatedPlants = Math.round(density * totalMeters);
    }

    const seedsSown = plantStock.seedsSown || 0;
    const germinationRate =
      seedsSown > 0
        ? Number(((estimatedPlants / seedsSown) * 100).toFixed(1))
        : null;

    return this.prismaService.plantCount.create({
      data: {
        plantStockId: id,
        countType: dto.countType,
        sampleSize: dto.sampleSize,
        countedPlants: dto.countedPlants,
        density: Number(density.toFixed(4)),
        estimatedPlants,
        germinationRate,
        notes: dto.notes ?? null,
      },
    });
  }
}
