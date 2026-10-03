import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SeasonService } from '../season/season.service';
import { MovementReason } from '../common/enums/movement-reason.enum';
import { AgriInputReferenceType } from '../common/enums/ledger-reference-type.enum';
import { notEnoughAgriInput } from '../common/agri-input-stock';
import { getPaginationParams } from '../common/pagination';
import { ERROR_MESSAGES } from '../common/error-messages';
import type { Actor } from '../common/actor';
import { AddAgriInputDto, AdjustAgriInputDto } from './dto/agri-inputs.dto';

/**
 * The catalogue fields a client actually shows for a product.
 *
 * `currentQuantity` is deliberately NOT among them: that column on
 * `PhytosanitaryProduct` is superseded and a season's stock is what
 * `AgriInputSeason.currentQuantity` says. Not sending it is one less number for
 * a screen to pick up by mistake.
 */
const PRODUCT_SELECT = {
  select: {
    id: true,
    name: true,
    activeIngredient: true,
    category: true,
    unit: true,
    notes: true,
  },
} as const;

/**
 * The products a season may use, and their stock (Phase 6).
 *
 * This module is the only place that answers the two questions that always go
 * together:
 *   - **is this product allowed this season?** — the row exists, or it does not
 *   - **how much is left?** — `currentQuantity` on that same row
 *
 * Stock is entered on the product itself: there is no delivery flow, and
 * no expiry or batch tracking.
 *
 * ⚠️ Consuming stock — logging a treatment — is NOT here yet. That is P6-06 and
 * it writes a `used` movement with the operation as its reference.
 */
@Injectable()
export class AgriInputsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly seasonService: SeasonService,
  ) {}

  // ============================================================
  // This season's list
  // ============================================================

  /** This season's products, alphabetically, searchable by name. */
  async findAll(q?: string, page?: string, pageSize?: string) {
    const seasonId = this.seasonService.getActiveSeasonId();

    const where = {
      seasonId,
      // A product that is not in the list has no row, so searching can only
      // ever find products this season is allowed to use.
      ...(q
        ? {
            product: {
              OR: [
                { name: { contains: q, mode: 'insensitive' as const } },
                {
                  activeIngredient: {
                    contains: q,
                    mode: 'insensitive' as const,
                  },
                },
                { category: { contains: q, mode: 'insensitive' as const } },
              ],
            },
          }
        : {}),
    };

    const include = { product: PRODUCT_SELECT };

    // Opt-in, the same way every other list in the app pages (AGRI-04): with no
    // page parameters the caller still gets a plain array.
    const pagination = getPaginationParams(page, pageSize);

    if (pagination) {
      const [total, items] = await Promise.all([
        this.prismaService.agriInputSeason.count({ where }),
        this.prismaService.agriInputSeason.findMany({
          where,
          include,
          orderBy: { product: { name: 'asc' } },
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

    return this.prismaService.agriInputSeason.findMany({
      where,
      include,
      orderBy: { product: { name: 'asc' } },
    });
  }

  /** One season's row, with its product. The ledger is a separate call. */
  async findOne(id: string) {
    const row = await this.prismaService.agriInputSeason.findUnique({
      where: { id },
      include: { product: PRODUCT_SELECT, season: { select: { code: true } } },
    });
    if (!row) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    // Reads are season-scoped (AGRI-04) — and `findMovements` comes through
    // here, so the ledger is scoped with it.
    this.seasonService.assertReadable(row.seasonId);

    return row;
  }

  /** Everything that moved this product's stock, newest first. */
  async findMovements(id: string) {
    await this.findOne(id);

    return this.prismaService.agriInputMovement.findMany({
      where: { inputSeasonId: id },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ============================================================
  // Writing
  // ============================================================

  /**
   * Put a catalogue product on this season's list.
   *
   * This is the action that both *allows* the product for the season and gives
   * its stock somewhere to live. An opening balance can be entered at the same
   * time — that is the leftover you counted in July.
   */
  async addProduct(dto: AddAgriInputDto, actor: Actor) {
    const seasonId = this.seasonService.getActiveSeasonId();
    const quantity = dto.openingQuantity ?? 0;

    if (quantity < 0) {
      throw new BadRequestException('An opening balance cannot be negative.');
    }

    const product = await this.prismaService.phytosanitaryProduct.findUnique({
      where: { id: dto.productId },
      select: { name: true },
    });
    if (!product) {
      throw new NotFoundException('That product no longer exists.');
    }

    return this.prismaService.$transaction(async (tx) => {
      // Read inside the transaction (AGRI-03). Outside it, two adds arriving
      // together both found nothing and the second came back as the generic
      // duplicate sentence. The unique key is still the real decider — its
      // wording is mapped in `error-messages.ts` so that path is readable too.
      const existing = await tx.agriInputSeason.findUnique({
        where: { seasonId_productId: { seasonId, productId: dto.productId } },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException(
          `"${product.name}" is already in this season's list.`,
        );
      }

      const row = await tx.agriInputSeason.create({
        data: { seasonId, productId: dto.productId, currentQuantity: quantity },
        include: { product: PRODUCT_SELECT },
      });

      // A zero opening balance is not a movement — nothing happened, and an
      // entry saying so would only be noise in the history.
      if (quantity !== 0) {
        await tx.agriInputMovement.create({
          data: {
            inputSeasonId: row.id,
            quantity,
            reason: MovementReason.OPENING,
            // Written by hand, so it says so — the same as `StockService.adjust`
            // does for seeds and peat (AGRI-04).
            referenceType: AgriInputReferenceType.MANUAL,
            note: dto.note ?? null,
            createdByName: actor.name,
          },
        });
      }

      return row;
    });
  }

  /**
   * Record a movement a person made by hand — a delivery that arrived, an
   * opening balance, a return, a write-off or a correction.
   *
   * Deliberately shaped exactly like `StockService.adjustStock()` for seeds and
   * peat, and for the same reasons: the quantity is signed and the reason only
   * labels it, so the sign can be checked against the reason; and a result below
   * zero is refused from INSIDE the transaction, which rolls the increment back
   * on its own.
   */
  async adjustStock(id: string, dto: AdjustAgriInputDto, actor: Actor) {
    const row = await this.findRowOrThrow(id);

    if (dto.quantity === 0) {
      throw new BadRequestException('Enter a quantity.');
    }

    if (dto.reason === MovementReason.USED) {
      throw new BadRequestException(
        'What was used is recorded when a treatment is logged, not by hand.',
      );
    }

    const removesStock =
      dto.reason === MovementReason.RETURNED_TO_CLIENT ||
      dto.reason === MovementReason.WASTE;

    if (removesStock && dto.quantity > 0) {
      throw new BadRequestException(
        'That reason can only be used to take stock out, not add it.',
      );
    }

    const addsStock =
      dto.reason === MovementReason.OPENING ||
      dto.reason === MovementReason.RECEIVED;

    if (addsStock && dto.quantity < 0) {
      throw new BadRequestException(
        'That reason can only be used to add stock, not take it out.',
      );
    }

    return this.prismaService.$transaction(async (tx) => {
      const updated = await tx.agriInputSeason.update({
        where: { id: row.id },
        data: { currentQuantity: { increment: dto.quantity } },
        include: { product: PRODUCT_SELECT },
      });

      if (updated.currentQuantity < 0) {
        throw new BadRequestException(
          notEnoughAgriInput({
            name: row.product.name,
            unit: row.product.unit,
            left: row.currentQuantity,
            seasonCode: row.season.code,
          }),
        );
      }

      await tx.agriInputMovement.create({
        data: {
          inputSeasonId: row.id,
          quantity: dto.quantity,
          reason: dto.reason,
          // Written by hand — see the opening balance above (AGRI-04).
          referenceType: AgriInputReferenceType.MANUAL,
          note: dto.note ?? null,
          createdByName: actor.name,
        },
      });

      return updated;
    });
  }

  /**
   * Take a product off this season's list.
   *
   * Refused once anything has actually happened to it, because deleting the row
   * takes its ledger with it (the foreign keys cascade) — that is history nobody
   * could reconstruct afterwards. A product added by mistake, before anything
   * touched it, still deletes cleanly.
   */
  async removeProduct(id: string) {
    const row = await this.findRowOrThrow(id);

    const [movements, operations, planEntries, programEntries] =
      await Promise.all([
        this.prismaService.agriInputMovement.count({
          where: { inputSeasonId: id },
        }),
        this.prismaService.cropOperation.count({
          where: { inputSeasonId: id },
        }),
        this.prismaService.cropCarePlanEntry.count({
          where: { inputSeasonId: id },
        }),
        this.prismaService.phytosanitaryProgramEntry.count({
          where: { inputSeasonId: id },
        }),
      ]);

    if (movements > 0) {
      throw new BadRequestException(
        `"${row.product.name}" already has stock movements in season ${row.season.code}, so it cannot be removed from the list.`,
      );
    }

    if (operations + planEntries + programEntries > 0) {
      throw new BadRequestException(
        `"${row.product.name}" has already been used in a plan, a treatment or the program this season, so it cannot be removed from the list.`,
      );
    }

    // The delete carries the same conditions as the checks above (AGRI-02).
    // Those checks are reads in their own statements, so a movement written in
    // between used to be cascaded away with the row and nothing said so; a
    // guarded delete cannot match in that case, and the sentence below is what
    // the admin sees instead.
    //
    // What it does not close: a movement committed after this statement's
    // snapshot but before it takes the row lock. Closing that needs the row
    // locked first (`SELECT … FOR UPDATE`, raw SQL) or a database constraint —
    // recorded in the plan rather than pretended here.
    const removed = await this.prismaService.agriInputSeason.deleteMany({
      where: {
        id,
        movements: { none: {} },
        operations: { none: {} },
        planEntries: { none: {} },
        programEntries: { none: {} },
      },
    });

    if (removed.count === 0) {
      throw new ConflictException(
        `"${row.product.name}" was used a moment ago, so it cannot be removed from the list. Refresh the page and try again.`,
      );
    }

    return { removed: true };
  }

  // ============================================================
  // Helpers
  // ============================================================

  /** The row, or a 404. Carries what every refusal message needs to name it. */
  private async findRowOrThrow(id: string) {
    const row = await this.prismaService.agriInputSeason.findUnique({
      where: { id },
      include: {
        product: { select: { name: true, unit: true } },
        season: { select: { code: true } },
      },
    });
    if (!row) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }
    return row;
  }
}
