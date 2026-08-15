import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateTunnelAssignmentsDto,
  UpdateTunnelAssignmentDto,
} from './dto/tunnel-assignment.dto';

@Injectable()
export class TrayTransportService {
  constructor(private prisma: PrismaService) {}

  async assign(dto: CreateTunnelAssignmentsDto) {
    const { assignments, transportDate } = dto;
    const date = transportDate ? new Date(transportDate) : new Date();

    const results: any[] = [];
    const planIdsToRecalculate = new Set<string>();

    for (const a of assignments) {
      const sowing = await this.prisma.sowingSSM.findUnique({
        where: { id: a.ssmSowingId },
        include: { tunnelAssignments: true, plantStock: true },
      });

      if (!sowing) {
        throw new NotFoundException(`SSM Sowing ${a.ssmSowingId} not found`);
      }

      const tunnel = await this.prisma.tunnel.findUnique({
        where: { id: a.tunnelId },
      });

      if (!tunnel) {
        throw new NotFoundException(`Tunnel ${a.tunnelId} not found`);
      }

      const alreadyAssigned = sowing.tunnelAssignments.reduce(
        (sum, ta) => sum + ta.numberOfTrays,
        0,
      );
      const remaining = sowing.numberOfTrays - alreadyAssigned;

      if (a.numberOfTrays > remaining) {
        throw new BadRequestException(
          `SSM Sowing ${a.ssmSowingId} has only ${remaining} trays remaining`,
        );
      }

      const existingAssignments =
        await this.prisma.sowingTunnelAssignment.findMany({
          where: { tunnelId: a.tunnelId },
        });
      const tunnelUsed = existingAssignments.reduce(
        (sum, ta) => sum + ta.numberOfTrays,
        0,
      );
      const tunnelAvailable = tunnel.capacity - tunnelUsed;

      if (a.numberOfTrays > tunnelAvailable) {
        throw new BadRequestException(
          `Tunnel ${tunnel.number} has only ${tunnelAvailable} capacity remaining`,
        );
      }

      const existing = sowing.tunnelAssignments.find(
        (ta) => ta.tunnelId === a.tunnelId,
      );

      let result;
      if (existing) {
        result = await this.prisma.sowingTunnelAssignment.update({
          where: { id: existing.id },
          data: { numberOfTrays: existing.numberOfTrays + a.numberOfTrays },
          include: {
            tunnel: true,
            ssmSowing: { select: { variety: true, numberOfTrays: true } },
          },
        });
      } else {
        result = await this.prisma.sowingTunnelAssignment.create({
          data: {
            ssmSowingId: a.ssmSowingId,
            tunnelId: a.tunnelId,
            numberOfTrays: a.numberOfTrays,
            transportDate: date,
          },
          include: {
            tunnel: true,
            ssmSowing: { select: { variety: true, numberOfTrays: true } },
          },
        });
      }

      // Propagate tunnel to SowingSSM (first assignment wins)
      if (!sowing.tunnelId) {
        await this.prisma.sowingSSM.update({
          where: { id: a.ssmSowingId },
          data: {
            tunnelId: a.tunnelId,
            tunnelNumber: tunnel.number,
          },
        });

        // Update PlantStock location if it still has the default
        if (sowing.plantStock?.location === 'Not assigned') {
          await this.prisma.plantStock.update({
            where: { id: sowing.plantStock.id },
            data: { location: tunnel.number },
          });
        }
      }

      planIdsToRecalculate.add(sowing.planId);
      results.push(result);
    }

    // Recalculate plan location for all affected plans
    for (const planId of planIdsToRecalculate) {
      await this.recalculatePlanLocation(planId);
    }

    return results;
  }

  /**
   * Recalculates SowingPlan.location by collecting all unique tunnel numbers
   * from all SowingSSM records and their tunnel assignments under the plan.
   */
  private async recalculatePlanLocation(planId: string) {
    const sowings = await this.prisma.sowingSSM.findMany({
      where: { planId },
      select: {
        tunnelNumber: true,
        tunnelAssignments: {
          select: { tunnel: { select: { number: true } } },
        },
      },
    });

    const tunnelNumbers = new Set<string>();

    for (const s of sowings) {
      // From the primary tunnel on the sowing record
      if (s.tunnelNumber) {
        tunnelNumbers.add(s.tunnelNumber);
      }
      // From all tray assignments
      for (const ta of s.tunnelAssignments) {
        tunnelNumbers.add(ta.tunnel.number);
      }
    }

    const location =
      tunnelNumbers.size > 0 ? [...tunnelNumbers].sort().join(', ') : null;

    await this.prisma.sowingPlan.update({
      where: { id: planId },
      data: { location },
    });
  }

  async findBySowing(ssmSowingId: string) {
    const sowing = await this.prisma.sowingSSM.findUnique({
      where: { id: ssmSowingId },
      include: {
        tunnelAssignments: {
          include: { tunnel: true },
          orderBy: { transportDate: 'desc' },
        },
      },
    });

    if (!sowing) {
      throw new NotFoundException(`SSM Sowing ${ssmSowingId} not found`);
    }

    return sowing.tunnelAssignments;
  }

  async findByTunnel(tunnelId: string) {
    const tunnel = await this.prisma.tunnel.findUnique({
      where: { id: tunnelId },
      include: {
        sowingTunnelAssignments: {
          include: {
            ssmSowing: {
              select: {
                id: true,
                variety: true,
                lotNumber: true,
                numberOfTrays: true,
              },
            },
          },
          orderBy: { transportDate: 'desc' },
        },
      },
    });

    if (!tunnel) {
      throw new NotFoundException(`Tunnel ${tunnelId} not found`);
    }

    return {
      tunnel: {
        id: tunnel.id,
        number: tunnel.number,
        capacity: tunnel.capacity,
      },
      assignments: tunnel.sowingTunnelAssignments,
      totalAssigned: tunnel.sowingTunnelAssignments.reduce(
        (sum, a) => sum + a.numberOfTrays,
        0,
      ),
    };
  }

  /**
   * Returns SSM sowings that still have trays remaining to transport,
   * grouped by plan, with tunnel assignment info.
   */
  async findPendingTransport() {
    const sowings = await this.prisma.sowingSSM.findMany({
      where: {
        plan: { planType: 'SSM' },
      },
      orderBy: { sowingDate: 'desc' },
      include: {
        plan: { select: { id: true, name: true } },
        tunnelAssignments: {
          include: { tunnel: { select: { id: true, number: true } } },
        },
      },
    });

    // Calculate remaining trays and filter those with remaining > 0
    const pending = sowings
      .map((s) => {
        const assigned = s.tunnelAssignments.reduce(
          (sum, ta) => sum + ta.numberOfTrays,
          0,
        );
        return {
          id: s.id,
          planId: s.plan.id,
          planName: s.plan.name,
          variety: s.variety,
          lotNumber: s.lotNumber,
          stockType: s.stockType,
          numberOfTrays: s.numberOfTrays,
          assignedTrays: assigned,
          remainingTrays: s.numberOfTrays - assigned,
          tunnelNumber: s.tunnelNumber,
          sowingDate: s.sowingDate,
          assignments: s.tunnelAssignments.map((ta) => ({
            id: ta.id,
            tunnelId: ta.tunnel.id,
            tunnelNumber: ta.tunnel.number,
            numberOfTrays: ta.numberOfTrays,
            transportDate: ta.transportDate,
          })),
        };
      })
      .filter((s) => s.remainingTrays > 0);

    // Group by plan
    const grouped: Record<
      string,
      { planId: string; planName: string; sowings: typeof pending }
    > = {};

    for (const s of pending) {
      if (!grouped[s.planId]) {
        grouped[s.planId] = {
          planId: s.planId,
          planName: s.planName,
          sowings: [],
        };
      }
      grouped[s.planId].sowings.push(s);
    }

    return Object.values(grouped);
  }

  async findAll() {
    return this.prisma.sowingTunnelAssignment.findMany({
      include: {
        tunnel: { select: { id: true, number: true, capacity: true } },
        ssmSowing: {
          select: {
            id: true,
            variety: true,
            numberOfTrays: true,
            lotNumber: true,
            plan: { select: { name: true } },
          },
        },
      },
      orderBy: { transportDate: 'desc' },
    });
  }

  async update(id: string, dto: UpdateTunnelAssignmentDto) {
    const existing = await this.prisma.sowingTunnelAssignment.findUnique({
      where: { id },
      include: { ssmSowing: true, tunnel: true },
    });

    if (!existing) {
      throw new NotFoundException(`Assignment ${id} not found`);
    }

    const sowing = await this.prisma.sowingSSM.findUnique({
      where: { id: existing.ssmSowingId },
      include: { tunnelAssignments: true },
    });

    if (!sowing) {
      throw new NotFoundException(
        `SSM Sowing ${existing.ssmSowingId} not found`,
      );
    }

    const otherAssigned = sowing.tunnelAssignments
      .filter((ta) => ta.id !== id)
      .reduce((sum, ta) => sum + ta.numberOfTrays, 0);
    const remaining = sowing.numberOfTrays - otherAssigned;

    if (dto.numberOfTrays > remaining) {
      throw new BadRequestException(
        `Only ${remaining} trays remaining for this sowing`,
      );
    }

    return this.prisma.sowingTunnelAssignment.update({
      where: { id },
      data: { numberOfTrays: dto.numberOfTrays },
      include: {
        tunnel: true,
        ssmSowing: { select: { variety: true, numberOfTrays: true } },
      },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.sowingTunnelAssignment.findUnique({
      where: { id },
      include: { ssmSowing: { select: { planId: true } } },
    });

    if (!existing) {
      throw new NotFoundException(`Assignment ${id} not found`);
    }

    const planId = existing.ssmSowing.planId;

    await this.prisma.sowingTunnelAssignment.delete({ where: { id } });

    // Recalculate plan location after removing an assignment
    await this.recalculatePlanLocation(planId);

    return { message: 'Assignment removed' };
  }
}
