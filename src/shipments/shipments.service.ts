import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../common/actor';
import { getPaginationParams } from '../common/pagination';
import { CreateShipmentDto } from './dto/shipment.dto';
import { SeasonService } from '../season/season.service';
import { HarvestReferenceType } from '../common/enums/ledger-reference-type.enum';
import { ERROR_MESSAGES } from '../common/error-messages';

@Injectable()
export class ShipmentsService {
  constructor(
    private prismaService: PrismaService,
    private seasonService: SeasonService,
  ) {}

  /**
   * The product behind a line, or a plain-language 400 if it was deleted while
   * the shipment was being filled in.
   */
  private productOrThrow<T extends { id: string }>(
    byId: Map<string, T>,
    id: string,
  ): T {
    const product = byId.get(id);
    if (!product) {
      throw new BadRequestException(
        'One of the products in this shipment no longer exists.',
      );
    }
    return product;
  }

  /**
   * Ship finished goods out.
   *
   * Each line moves `boxCount x plantsPerBox` plants out of a harvested product
   * and writes a negative movement, so the audit trail stays complete.
   *
   * Everything that decides happens **inside** the transaction (SHIP-01): the
   * stock read, the check, the shipment row and the draw-down are one unit, and
   * the draw-down is a conditional UPDATE rather than a plain decrement. Doing
   * the check before the transaction — which is what this did — let two
   * shipments pass the same check and drive a pool below zero.
   */
  async create(dto: CreateShipmentDto, actor: Actor) {
    const seasonId = this.seasonService.getActiveSeasonId();

    // The truck, if one was named, has to be this season's (SHIP-02).
    if (dto.truckId) {
      await this.assertTruckInSeason(dto.truckId, seasonId);
    }

    // The shipment date has to belong to the season it is filed into (SEASON-08).
    await this.seasonService.assertDateInSeason(
      new Date(dto.shipmentDate),
      'shipment date',
      seasonId,
    );

    return this.prismaService.$transaction(async (tx) => {
      const products = await tx.harvestedProduct.findMany({
        where: {
          id: { in: [...new Set(dto.lines.map((l) => l.harvestedProductId))] },
        },
      });
      const byId = new Map(products.map((p) => [p.id, p]));

      // Plants per box comes from the product, never from the request: the box
      // size is part of what the product IS, so the server is the only correct
      // source. Merged per product, because two lines of the same product have
      // to be checked against stock together.
      const plantsPerProduct = new Map<string, number>();
      for (const line of dto.lines) {
        const product = this.productOrThrow(byId, line.harvestedProductId);
        plantsPerProduct.set(
          product.id,
          (plantsPerProduct.get(product.id) ?? 0) +
            line.boxCount * product.plantsPerBox,
        );
      }

      const shipment = await tx.shipment.create({
        data: {
          seasonId,
          shipmentNumber: dto.shipmentNumber,
          shipmentDate: new Date(dto.shipmentDate),
          truckId: dto.truckId,
          createdBy: actor.id,
          lines: {
            create: dto.lines.map((l) => {
              const { plantsPerBox } = this.productOrThrow(
                byId,
                l.harvestedProductId,
              );
              return {
                harvestedProductId: l.harvestedProductId,
                boxCount: l.boxCount,
                plantsPerBox,
                totalPlants: l.boxCount * plantsPerBox,
              };
            }),
          },
        },
        include: { lines: { include: { harvestedProduct: true } } },
      });

      // One guarded statement per product (SHIP-01). The condition sits in the
      // UPDATE's WHERE, so Postgres re-checks it against the row it locks: of two
      // shipments arriving together, the first takes the stock and the second
      // matches nothing — instead of both taking it and the pool going negative.
      for (const [productId, plants] of plantsPerProduct) {
        const product = this.productOrThrow(byId, productId);

        const taken = await tx.harvestedProduct.updateMany({
          where: { id: productId, currentQuantity: { gte: plants } },
          data: { currentQuantity: { decrement: plants } },
        });

        if (taken.count === 0) {
          const now = await tx.harvestedProduct.findUnique({
            where: { id: productId },
            select: { currentQuantity: true },
          });

          throw new BadRequestException(
            `Not enough ${product.name} in stock: ${(now?.currentQuantity ?? 0).toLocaleString('en-GB')} left, but this shipment takes ${plants.toLocaleString('en-GB')}.`,
          );
        }
      }

      // One ledger line per line of the shipment, so the history shows what each
      // line took even when the same product appears twice.
      for (const line of shipment.lines) {
        await tx.harvestStockMovement.create({
          data: {
            harvestedProductId: line.harvestedProductId,
            quantity: -line.totalPlants,
            referenceType: HarvestReferenceType.SHIPMENT,
            referenceId: shipment.id,
            createdByName: actor.name,
          },
        });
      }

      return shipment;
    });
  }

  /**
   * The truck a shipment names has to belong to the season the shipment is filed
   * into (SHIP-02) — the same rule the location checks follow in the other
   * modules.
   */
  private async assertTruckInSeason(truckId: string, seasonId: string) {
    const truck = await this.prismaService.truck.findUnique({
      where: { id: truckId },
      select: { seasonId: true },
    });

    if (!truck || truck.seasonId !== seasonId) {
      throw new BadRequestException(
        'That truck is not part of the open season. Pick the truck again.',
      );
    }
  }

  /**
   * Edit a shipment — header AND lines.
   *
   * Lines can change, so the stock has to be reconciled: the old lines go back
   * first, the new ones are then checked against the restored figures, and only
   * afterwards are they drawn down. In that order, re-shipping the same product
   * does not fail the stock check against its own earlier draw.
   *
   * All inside one transaction, so if the new lines exceed stock the whole edit
   * rolls back and the shipment is left exactly as it was.
   */
  async update(id: string, dto: CreateShipmentDto, actor: Actor) {
    return this.prismaService.$transaction(async (tx) => {
      const existing = await tx.shipment.findUnique({
        where: { id },
        include: { lines: true },
      });

      if (!existing) {
        throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
      }

      // Judged against the shipment's OWN season (SHIP-02): a shipment filed in
      // one season may only name a truck of that season.
      if (dto.truckId) {
        await this.assertTruckInSeason(dto.truckId, existing.seasonId);
      }

      // Judged against the shipment's OWN season, not the open one (SEASON-08).
      await this.seasonService.assertDateInSeason(
        new Date(dto.shipmentDate),
        'shipment date',
        existing.seasonId,
      );

      // 1. Put the old lines back into stock — and RECORD that we did. The
      //    ledger is append-only (P7-10): the lines that took the plants out
      //    stay, and a reversing movement is added, so an edited shipment still
      //    shows what it originally did. Nothing is ever erased from a ledger.
      for (const line of existing.lines) {
        await tx.harvestedProduct.update({
          where: { id: line.harvestedProductId },
          data: { currentQuantity: { increment: line.totalPlants } },
        });

        await tx.harvestStockMovement.create({
          data: {
            harvestedProductId: line.harvestedProductId,
            quantity: line.totalPlants,
            referenceType: HarvestReferenceType.SHIPMENT,
            referenceId: id,
            reason: 'correction',
            note: 'Shipment edited — these boxes went back into stock.',
            createdByName: actor.name,
          },
        });
      }

      await tx.shipmentLine.deleteMany({ where: { shipmentId: id } });

      // 2. Check the NEW lines against the restored stock. Duplicate products
      //    are merged first, exactly as in create().
      const productIds = [
        ...new Set(dto.lines.map((l) => l.harvestedProductId)),
      ];
      const products = await tx.harvestedProduct.findMany({
        where: { id: { in: productIds } },
      });
      const byId = new Map(products.map((p) => [p.id, p]));

      // Box size comes from the product, not the request — see create().
      const perProduct = new Map<string, number>();
      for (const line of dto.lines) {
        const product = this.productOrThrow(byId, line.harvestedProductId);
        perProduct.set(
          product.id,
          (perProduct.get(product.id) ?? 0) +
            line.boxCount * product.plantsPerBox,
        );
      }

      for (const [productId, plants] of perProduct) {
        const product = this.productOrThrow(byId, productId);
        if (plants > product.currentQuantity) {
          throw new BadRequestException(
            `Not enough ${product.name} in stock: ${product.currentQuantity.toLocaleString(
              'en-GB',
            )} left, but this shipment takes ${plants.toLocaleString('en-GB')}.`,
          );
        }
      }

      // 3. Apply the new header and lines, then draw the stock down.
      const shipment = await tx.shipment.update({
        where: { id },
        data: {
          shipmentNumber: dto.shipmentNumber,
          shipmentDate: new Date(dto.shipmentDate),
          truckId: dto.truckId,
          lines: {
            create: dto.lines.map((l) => {
              const { plantsPerBox } = this.productOrThrow(
                byId,
                l.harvestedProductId,
              );
              return {
                harvestedProductId: l.harvestedProductId,
                boxCount: l.boxCount,
                plantsPerBox,
                totalPlants: l.boxCount * plantsPerBox,
              };
            }),
          },
        },
        include: {
          lines: { include: { harvestedProduct: true } },
          truck: true,
        },
      });

      // The same guarded draw-down as `create` (SHIP-01), per product, because
      // `perProduct` is what was checked three steps above.
      for (const [productId, plants] of perProduct) {
        const product = this.productOrThrow(byId, productId);

        const taken = await tx.harvestedProduct.updateMany({
          where: { id: productId, currentQuantity: { gte: plants } },
          data: { currentQuantity: { decrement: plants } },
        });

        if (taken.count === 0) {
          const now = await tx.harvestedProduct.findUnique({
            where: { id: productId },
            select: { currentQuantity: true },
          });

          throw new BadRequestException(
            `Not enough ${product.name} in stock: ${(now?.currentQuantity ?? 0).toLocaleString('en-GB')} left, but this shipment takes ${plants.toLocaleString('en-GB')}.`,
          );
        }
      }

      for (const line of shipment.lines) {
        await tx.harvestStockMovement.create({
          data: {
            harvestedProductId: line.harvestedProductId,
            quantity: -line.totalPlants,
            referenceType: HarvestReferenceType.SHIPMENT,
            referenceId: shipment.id,
            createdByName: actor.name,
          },
        });
      }

      return shipment;
    });
  }

  async findAll(q?: string, page?: string, pageSize?: string) {
    const where: Record<string, unknown> = {
      seasonId: this.seasonService.getActiveSeasonId(),
    };

    if (q) {
      where.OR = [
        { shipmentNumber: { contains: q, mode: 'insensitive' as const } },
        // truck is a relation now, so search its name rather than the column
        { truck: { name: { contains: q, mode: 'insensitive' as const } } },
      ];
    }

    const include = {
      lines: { include: { harvestedProduct: true } },
      truck: true,
    };
    const pagination = getPaginationParams(page, pageSize);

    if (pagination) {
      const [total, items] = await Promise.all([
        this.prismaService.shipment.count({ where }),
        this.prismaService.shipment.findMany({
          where,
          include,
          orderBy: { shipmentDate: 'desc' },
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

    return this.prismaService.shipment.findMany({
      where,
      include,
      orderBy: { shipmentDate: 'desc' },
    });
  }

  async findOne(id: string) {
    const shipment = await this.prismaService.shipment.findUnique({
      where: { id },
      include: {
        lines: { include: { harvestedProduct: true } },
        truck: true,
      },
    });

    if (!shipment) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    // Reads are season-scoped too (SHIP-03). `findAll` always filtered; this did
    // not, so `GET /shipments/:id` answered with another season's shipment.
    this.seasonService.assertReadable(shipment.seasonId);

    return shipment;
  }

  /**
   * Undo a shipment: return the plants to stock and add a **reversing** ledger
   * line for it (P7-10 — append-only; nothing is ever deleted from a ledger).
   *
   * Unlike deleting a harvest (which can push stock below zero), this always
   * adds stock back, so it can never corrupt the figure.
   */
  async remove(id: string, actor: Actor) {
    const shipment = await this.prismaService.shipment.findUnique({
      where: { id },
      include: { lines: true },
    });

    if (!shipment) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    // A delete is judged against the season the shipment belongs to, not the
    // caller's idea of the current one (SHIP-03).
    this.seasonService.assertReadable(shipment.seasonId);

    return this.prismaService.$transaction(async (tx) => {
      for (const line of shipment.lines) {
        await tx.harvestedProduct.update({
          where: { id: line.harvestedProductId },
          data: { currentQuantity: { increment: line.totalPlants } },
        });

        // The reversing line stays in the ledger after the shipment itself is
        // gone, so `referenceId` ends up pointing at a deleted shipment. That is
        // deliberate: the `note` says what happened, and the alternative —
        // erasing the movement — is the thing append-only forbids (see P7-11).
        await tx.harvestStockMovement.create({
          data: {
            harvestedProductId: line.harvestedProductId,
            quantity: line.totalPlants,
            referenceType: HarvestReferenceType.SHIPMENT,
            referenceId: id,
            reason: 'correction',
            note: 'Shipment deleted — these boxes went back into stock.',
            createdByName: actor.name,
          },
        });
      }

      await tx.shipment.delete({ where: { id } });

      return { id };
    });
  }
}
