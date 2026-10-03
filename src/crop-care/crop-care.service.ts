import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import type { PhytosanitaryProduct } from '../generated/prisma/client';
import { getPaginationParams } from '../common/pagination';
import { ERROR_MESSAGES } from '../common/error-messages';
import { MovementReason } from '../common/enums/movement-reason.enum';
import { AgriInputReferenceType } from '../common/enums/ledger-reference-type.enum';
import { notEnoughAgriInput } from '../common/agri-input-stock';
import type { Actor } from '../common/actor';
import {
  CreatePhytosanitaryProductDto,
  UpdatePhytosanitaryProductDto,
  CreatePhytosanitaryProgramDto,
  UpdatePhytosanitaryProgramDto,
  CreateCropOperationDto,
  CreateCropCarePlanDto,
  ExecutePlanEntryDto,
  LocationDto,
} from './dto/crop-care.dto';

import { SeasonService } from '../season/season.service';

/** Either client — the same alias pattern the stock and close services use. */
type Db = PrismaService | Prisma.TransactionClient;

/**
 * The season row, read down to the two fields clients actually know about.
 *
 * P6-03 moved the three crop-care links off the global catalogue and onto that
 * season's `AgriInputSeason` row. **The JSON did not move with them:**
 * every response still carries `productId` + `product`, because `inputSeason` is
 * an internal detail. Flattening it back here is what kept the web app and the
 * phone app out of this change entirely.
 */
const INPUT_SEASON = {
  select: { productId: true, product: true },
} as const;

/** A row read with `inputSeason: INPUT_SEASON`. */
type WithInputSeason = {
  inputSeason?: { productId: string; product: PhytosanitaryProduct } | null;
};

@Injectable()
export class CropCareService {
  constructor(
    private prismaService: PrismaService,
    private seasonService: SeasonService,
  ) {}

  // ============================================================
  // Shared: the season row ↔ the flat shape clients know
  // ============================================================

  /**
   * Put a row back into the shape both clients already expect.
   *
   * `productId` is the **catalogue** product's id — the value the client sent
   * and the value `applied[productId]` in the compliance matrix is keyed on.
   * The season row's own id never leaves the backend.
   */
  private flattenInputSeason<T extends WithInputSeason>(row: T) {
    const { inputSeason, ...rest } = row;
    return {
      ...rest,
      productId: inputSeason?.productId ?? null,
      product: inputSeason?.product
        ? this.withoutStaleStock(inputSeason.product)
        : null,
    };
  }

  /**
   * The product, minus the stock figure.
   *
   * `PhytosanitaryProduct.currentQuantity` is superseded — the live number is
   * the season's `AgriInputSeason` row — and agri-inputs deliberately never
   * sends it. `INPUT_SEASON` selects the whole product row, so every crop-care
   * response carried it anyway (CROP-07): a stale quantity sitting next to the
   * fresh one, which is the confusion the split was meant to end.
   */
  private withoutStaleStock(product: PhytosanitaryProduct) {
    const { currentQuantity: _superseded, ...rest } = product;
    return rest;
  }

  private flattenInputSeasons<T extends WithInputSeason>(rows: T[]) {
    return rows.map((row) => this.flattenInputSeason(row));
  }

  /**
   * A location has to say which tunnel or sector it means, and that record has
   * to belong to the season the operation is filed into (CROP-05).
   *
   * Nothing checked this before. A location could arrive as
   * `{ targetType: 'TUNNEL' }` with no id, and the compliance matrix keys its
   * cells on `TUNNEL:<id>` — so the treatment was filed, took stock out of the
   * season, and could then never appear against the tunnel it was applied to.
   * It matched nothing, and nothing said why.
   */
  private async assertLocationsUseable(
    locations: LocationDto[],
    seasonId: string,
    db: Db = this.prismaService,
  ) {
    const tunnelIds: string[] = [];
    const sectorIds: string[] = [];

    for (const location of locations) {
      if (location.tunnelId && location.sectorId) {
        throw new BadRequestException(
          'A location is either a tunnel or a sector, not both.',
        );
      }

      if (location.targetType === 'TUNNEL') {
        if (!location.tunnelId) {
          throw new BadRequestException(
            'Choose a tunnel for each location you picked.',
          );
        }
        tunnelIds.push(location.tunnelId);
      } else {
        if (!location.sectorId) {
          throw new BadRequestException(
            'Choose a sector for each location you picked.',
          );
        }
        sectorIds.push(location.sectorId);
      }
    }

    // The records themselves have to be in that season: another season's tunnel
    // is not a place this operation was applied, and the matrix is per season.
    if (tunnelIds.length > 0) {
      const found = await db.tunnel.count({
        where: { id: { in: tunnelIds }, seasonId },
      });

      if (found !== new Set(tunnelIds).size) {
        throw new BadRequestException(
          'One of the tunnels you picked is not part of this season. Refresh the page and pick again.',
        );
      }
    }

    if (sectorIds.length > 0) {
      const found = await db.sector.count({
        where: { id: { in: sectorIds }, seasonId },
      });

      if (found !== new Set(sectorIds).size) {
        throw new BadRequestException(
          'One of the sectors you picked is not part of this season. Refresh the page and pick again.',
        );
      }
    }
  }

  /**
   * Turn the catalogue product a client named into that season's row.
   *
   * This is the point of P6-03: a treatment names a product, but what it is
   * stored against is the season row, so the stock it will deduct from can only
   * ever be its own season's.
   *
   * A missing row is **refused, never created silently**: "no row" means
   * "not permitted that season", and quietly allowing it would make the whole
   * per-season list meaningless.
   */
  private async resolveInputSeasonId(
    productId: string | null | undefined,
    seasonId: string,
    db: Db = this.prismaService,
  ): Promise<string | null> {
    if (!productId) return null;

    const row = await db.agriInputSeason.findUnique({
      where: { seasonId_productId: { seasonId, productId } },
      select: { id: true },
    });
    if (row) return row.id;

    const product = await db.phytosanitaryProduct.findUnique({
      where: { id: productId },
      select: { name: true },
    });
    throw new BadRequestException(
      product
        ? `"${product.name}" is not allowed in this season. Add it to the season first.`
        : 'That product no longer exists.',
    );
  }

  /**
   * Take what a treatment used out of the season's stock, and write the ledger
   * line for it (P6-06).
   *
   * Refused **from inside the transaction** when there is not enough left, so the
   * operation that caused it is rolled back with it. That is the same rule the
   * manual adjustment follows, and deliberately not the rule a sowing follows —
   * a sowing may overrun into negative stock, because you may sow before the
   * delivery has been written down. A treatment is only ever recorded after the
   * fact, so a shortage there is nearly always a wrong number.
   */
  private async consumeAgriInput(
    db: Db,
    inputSeasonId: string,
    quantity: number,
    referenceId: string,
    note: string | null,
    actorName: string,
  ) {
    const row = await db.agriInputSeason.findUnique({
      where: { id: inputSeasonId },
      include: {
        product: { select: { name: true, unit: true } },
        season: { select: { code: true } },
      },
    });
    if (!row) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    const updated = await db.agriInputSeason.update({
      where: { id: inputSeasonId },
      data: { currentQuantity: { decrement: quantity } },
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

    await db.agriInputMovement.create({
      data: {
        inputSeasonId,
        quantity: -Math.abs(quantity),
        reason: MovementReason.USED,
        referenceType: AgriInputReferenceType.OPERATION,
        referenceId,
        note,
        createdByName: actorName,
      },
    });
  }

  /**
   * Give back what a deleted treatment had used (decision 2a, 2026-09-29).
   *
   * Append-only on purpose: the `used` line stays and a reversing one is added,
   * so the history still shows that the treatment happened and was afterwards
   * removed. Editing or deleting the original line would erase exactly the fact
   * somebody may later need to check.
   *
   * The season row is guaranteed to still be there: `AgriInputsService` refuses
   * to remove a product from a season once it has movements, and the `used` line
   * above is one.
   */
  private async restoreAgriInput(
    db: Db,
    inputSeasonId: string,
    quantity: number,
    referenceId: string,
    actorName: string,
  ) {
    await db.agriInputSeason.update({
      where: { id: inputSeasonId },
      data: { currentQuantity: { increment: quantity } },
    });

    await db.agriInputMovement.create({
      data: {
        inputSeasonId,
        quantity: Math.abs(quantity),
        reason: MovementReason.CORRECTION,
        referenceType: AgriInputReferenceType.OPERATION,
        referenceId,
        note: 'Treatment deleted — the stock was added back.',
        createdByName: actorName,
      },
    });
  }

  // ============================================================
  // Phytosanitary products (catalog)
  // ============================================================

  /**
   * The **global** catalogue — typed once, never per season — which is why
   * there is no season filter here. Which of these a season may actually use is
   * a different question, answered by that season's `AgriInputSeason` rows.
   */
  async findAllProducts(q?: string) {
    const where = q
      ? {
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
        }
      : {};

    return this.prismaService.phytosanitaryProduct.findMany({
      where,
      orderBy: { name: 'asc' },
    });
  }

  async createProduct(dto: CreatePhytosanitaryProductDto) {
    await this.assertProductNameFree(dto.name);

    return this.prismaService.phytosanitaryProduct.create({ data: dto });
  }

  /**
   * The catalogue is global, and "Copper" and "copper" are the same product to
   * the person typing it, so this check ignores case (CROP-06). The `@unique`
   * behind it does not, which is how two of them could exist side by side and
   * split a season's stock between them.
   */
  private async assertProductNameFree(name: string, exceptId?: string) {
    const clash = await this.prismaService.phytosanitaryProduct.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { name: true },
    });

    if (clash) {
      throw new ConflictException(
        `A product called "${clash.name}" already exists.`,
      );
    }
  }

  async findOneProduct(id: string) {
    const product = await this.prismaService.phytosanitaryProduct.findUnique({
      where: { id },
    });
    if (!product) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }
    return product;
  }

  async updateProduct(id: string, dto: UpdatePhytosanitaryProductDto) {
    await this.findOneProduct(id);
    return this.prismaService.phytosanitaryProduct.update({
      where: { id },
      data: dto,
    });
  }

  async deleteProduct(id: string) {
    await this.findOneProduct(id);
    return this.prismaService.phytosanitaryProduct.delete({ where: { id } });
  }

  // ============================================================
  // Phytosanitary program (per-season "must-use before harvest" list)
  // ============================================================

  /**
   * This season's program, or null when it has none yet.
   *
   * **Per season** (P6-14): a program is set up once per season, so after a close
   * the new season starts with no program rather than silently inheriting the
   * closed one's. That is the point of the list — a country restriction that
   * changes between seasons is exactly what it exists to express, so carrying it
   * over would have been wrong by design.
   */
  async getProgram() {
    const program = await this.prismaService.phytosanitaryProgram.findFirst({
      where: { active: true, seasonId: this.seasonService.getActiveSeasonId() },
      include: {
        entries: {
          include: { inputSeason: INPUT_SEASON },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!program) return null;

    return {
      ...program,
      entries: this.flattenInputSeasons(program.entries),
    };
  }

  async createProgram(dto: CreatePhytosanitaryProgramDto) {
    const seasonId = this.seasonService.getActiveSeasonId();

    // The same check the products get (CROP-06), within the season because a
    // program belongs to one. Before this, the raw `@unique` answered a second
    // "Copper" — or the same name in different case — with the generic
    // duplicate sentence, or let it through entirely.
    const clash = await this.prismaService.phytosanitaryProgram.findFirst({
      where: { seasonId, name: { equals: dto.name, mode: 'insensitive' } },
      select: { name: true },
    });

    if (clash) {
      throw new ConflictException(
        `A program called "${clash.name}" already exists in this season.`,
      );
    }

    // Switching off the previous program is a PER-SEASON act (P6-14): another
    // season's program is not this season's to close.
    return this.prismaService.$transaction(async (tx) => {
      await tx.phytosanitaryProgram.updateMany({
        where: { active: true, seasonId },
        data: { active: false },
      });
      return tx.phytosanitaryProgram.create({
        data: {
          ...dto,
          seasonId,
          active: true,
        },
      });
    });
  }

  async updateProgram(id: string, dto: UpdatePhytosanitaryProgramDto) {
    const existing = await this.prismaService.phytosanitaryProgram.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    return this.prismaService.$transaction(async (tx) => {
      const { productIds, ...rest } = dto;

      const program = await tx.phytosanitaryProgram.update({
        where: { id },
        data: rest,
      });

      if (productIds) {
        // Replace the required products list
        await tx.phytosanitaryProgramEntry.deleteMany({
          where: { programId: id },
        });

        // A program belongs to a season, so its products resolve against THAT
        // season — not the open one, which may already be a different season.
        const entries: { programId: string; inputSeasonId: string }[] = [];
        for (const productId of productIds) {
          const inputSeasonId = await this.resolveInputSeasonId(
            productId,
            existing.seasonId,
            tx,
          );
          if (inputSeasonId) entries.push({ programId: id, inputSeasonId });
        }

        if (entries.length > 0) {
          await tx.phytosanitaryProgramEntry.createMany({
            data: entries,
            skipDuplicates: true,
          });
        }
      }

      const updated = await tx.phytosanitaryProgram.findUnique({
        where: { id },
        include: {
          entries: {
            include: { inputSeason: INPUT_SEASON },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      return updated
        ? { ...updated, entries: this.flattenInputSeasons(updated.entries) }
        : null;
    });
  }

  // ============================================================
  // Compliance matrix
  // ============================================================

  async getCompliance() {
    const seasonId = this.seasonService.getActiveSeasonId();
    const program = await this.getProgram();

    const [tunnels, sectors, operations] = await Promise.all([
      this.prismaService.tunnel.findMany({
        where: { seasonId },
        orderBy: { number: 'asc' },
      }),
      this.prismaService.sector.findMany({
        where: { seasonId },
        orderBy: { name: 'asc' },
      }),
      this.prismaService.cropOperation.findMany({
        where: { seasonId, inputSeasonId: { not: null } },
        include: { locations: true, inputSeason: INPUT_SEASON },
        orderBy: { performedAt: 'desc' },
      }),
    ]);

    const locations = [
      ...tunnels.map((t) => ({
        key: `TUNNEL:${t.id}`,
        targetType: 'TUNNEL',
        targetId: t.id,
        name: t.number,
      })),
      ...sectors.map((s) => ({
        key: `SECTOR:${s.id}`,
        targetType: 'SECTOR',
        targetId: s.id,
        name: s.name,
      })),
    ];

    // applied[productId][locationKey] = latest performedAt
    const applied: Record<string, Record<string, string>> = {};
    for (const op of this.flattenInputSeasons(operations)) {
      if (!op.productId) continue;
      for (const loc of op.locations) {
        const targetId =
          loc.targetType === 'TUNNEL' ? loc.tunnelId : loc.sectorId;

        // A location that names nothing cannot match anything: it used to be
        // filed under "TUNNEL:null", a key no cell in this matrix has
        // (CROP-05). New rows cannot be created that way any more, and older
        // ones are skipped rather than pretending to be a place.
        if (!targetId) continue;

        const key = `${loc.targetType}:${targetId}`;
        applied[op.productId] = applied[op.productId] || {};
        const prev = applied[op.productId][key];
        const t = op.performedAt.getTime();
        if (!prev || t > new Date(prev).getTime()) {
          applied[op.productId][key] = op.performedAt.toISOString();
        }
      }
    }

    const products = program
      ? program.entries.map((e) => ({
          id: e.productId,
          name: e.product?.name ?? '',
          activeIngredient: e.product?.activeIngredient ?? null,
          category: e.product?.category ?? null,
          unit: e.product?.unit ?? null,
        }))
      : [];

    return {
      program: program
        ? { id: program.id, name: program.name, notes: program.notes }
        : null,
      products,
      locations,
      applied,
    };
  }

  // ============================================================
  // Crop operations (standalone + from plan execution)
  // ============================================================

  async createOperation(dto: CreateCropOperationDto, actor: Actor) {
    // A treatment and a fertilisation both name a product and both take stock
    // out of the season (P6-07); irrigation names nothing and moves nothing.
    const usesProduct =
      dto.operationType === 'TREATMENT' ||
      dto.operationType === 'FERTILISATION';

    if (usesProduct && !dto.productId) {
      throw new BadRequestException(
        dto.operationType === 'FERTILISATION'
          ? 'Choose the fertiliser that was applied.'
          : 'Choose the product that was used.',
      );
    }
    if (!dto.locations || dto.locations.length === 0) {
      throw new BadRequestException('At least one location is required');
    }
    // Naming a product means saying how much was used (decision 1b, 2026-09-29).
    // The quantity is what the stock is taken out by, so a treatment without one
    // would quietly leave the number wrong — and the phone only sends it
    // sometimes, which is exactly how that would have happened.
    if (dto.productId && !(dto.quantity && dto.quantity > 0)) {
      throw new BadRequestException(
        'Enter how much was used — that is what comes out of the stock.',
      );
    }

    const seasonId = this.seasonService.getActiveSeasonId();

    await this.assertLocationsUseable(dto.locations, seasonId);

    // The operation date has to belong to the season it is filed into
    // (SEASON-08).
    await this.seasonService.assertDateInSeason(
      new Date(dto.performedAt),
      'operation date',
      seasonId,
    );

    return this.prismaService.$transaction(async (tx) => {
      const operation = await tx.cropOperation.create({
        data: {
          seasonId,
          operationType: dto.operationType,
          inputSeasonId: await this.resolveInputSeasonId(
            dto.productId,
            seasonId,
            tx,
          ),
          source: 'MANUAL',
          quantity: dto.quantity,
          performedAt: new Date(dto.performedAt),
          notes: dto.notes,
          createdBy: actor.id,
          locations: {
            create: dto.locations.map((l) => ({
              targetType: l.targetType,
              tunnelId: l.tunnelId,
              sectorId: l.sectorId,
            })),
          },
        },
        include: { locations: true, inputSeason: INPUT_SEASON },
      });

      // After the create, because the ledger line names the operation — and
      // inside the transaction, so a shortage rolls the operation back too
      // instead of recording a use that could not have happened.
      if (operation.inputSeasonId && dto.quantity) {
        await this.consumeAgriInput(
          tx,
          operation.inputSeasonId,
          dto.quantity,
          operation.id,
          dto.notes ?? null,
          actor.name,
        );
      }

      return this.flattenInputSeason(operation);
    });
  }

  async findAllOperations(
    q?: string,
    page?: string,
    pageSize?: string,
    operationType?: string,
    targetType?: string,
    targetId?: string,
  ) {
    const where: Record<string, unknown> = {
      seasonId: this.seasonService.getActiveSeasonId(),
    };

    if (operationType) where.operationType = operationType;

    if (q) {
      where.OR = [
        { notes: { contains: q, mode: 'insensitive' as const } },
        {
          inputSeason: {
            product: { name: { contains: q, mode: 'insensitive' as const } },
          },
        },
      ];
    }

    if (targetType && targetId) {
      where.locations = {
        some: {
          targetType,
          ...(targetType === 'TUNNEL'
            ? { tunnelId: targetId }
            : { sectorId: targetId }),
        },
      };
    }

    const include = {
      inputSeason: INPUT_SEASON,
      locations: { include: { tunnel: true, sector: true } },
      planEntry: { include: { plan: { select: { id: true, name: true } } } },
    };

    const pagination = getPaginationParams(page, pageSize);
    if (pagination) {
      const [total, items] = await Promise.all([
        this.prismaService.cropOperation.count({ where }),
        this.prismaService.cropOperation.findMany({
          where,
          include,
          orderBy: { performedAt: 'desc' },
          skip: pagination.skip,
          take: pagination.take,
        }),
      ]);
      return {
        items: this.flattenInputSeasons(items),
        total,
        page: pagination.page,
        pageSize: pagination.pageSize,
        hasMore: pagination.page * pagination.pageSize < total,
      };
    }

    const operations = await this.prismaService.cropOperation.findMany({
      where,
      include,
      orderBy: { performedAt: 'desc' },
    });
    return this.flattenInputSeasons(operations);
  }

  async findOneOperation(id: string) {
    const operation = await this.prismaService.cropOperation.findUnique({
      where: { id },
      include: {
        inputSeason: INPUT_SEASON,
        locations: { include: { tunnel: true, sector: true } },
        planEntry: { include: { plan: { select: { id: true, name: true } } } },
      },
    });
    if (!operation) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }
    return this.flattenInputSeason(operation);
  }

  async deleteOperation(id: string, actor: Actor) {
    const operation = await this.findOneOperation(id);

    return this.prismaService.$transaction(async (tx) => {
      const deleted = await tx.cropOperation.delete({ where: { id } });

      // Decision 2a (2026-09-29): give back what it used. Deleting a sowing
      // restores its seed the same way, so chemicals behaving differently would
      // only ever be a surprise.
      if (operation.inputSeasonId && operation.quantity) {
        await this.restoreAgriInput(
          tx,
          operation.inputSeasonId,
          operation.quantity,
          id,
          actor.name,
        );
      }

      // The entry that produced this operation goes back to "planned"
      // (CROP-02). Without this the entry stayed EXECUTED with nothing behind
      // it: the plan reported 100 % for work nobody had recorded, and the entry
      // could never be executed again — the execute guard refuses an EXECUTED
      // entry, for good and with no way back.
      if (operation.planEntryId) {
        await tx.cropCarePlanEntry.update({
          where: { id: operation.planEntryId },
          data: { status: 'PLANNED', executedAt: null, executedBy: null },
        });
      }

      return deleted;
    });
  }

  // ============================================================
  // Crop care plans
  // ============================================================

  async createPlan(dto: CreateCropCarePlanDto) {
    if (!dto.entries || dto.entries.length === 0) {
      throw new BadRequestException('At least one entry is required');
    }

    const seasonId = this.seasonService.getActiveSeasonId();

    // A plan name is unique inside its season (the `@@unique` has carried the
    // season since P6-10), so the check is too — and case-insensitive, for the
    // same reason as products (CROP-06). Without it a second plan with the same
    // name reached the database and came back as the generic duplicate
    // sentence, with nothing naming the plan that was already there.
    const clash = await this.prismaService.cropCarePlan.findFirst({
      where: { seasonId, name: { equals: dto.name, mode: 'insensitive' } },
      select: { name: true },
    });

    if (clash) {
      throw new ConflictException(
        `A crop care plan called "${clash.name}" already exists in this season.`,
      );
    }

    return this.prismaService.$transaction(async (tx) => {
      // Every entry that names a product resolves to THIS season's row, so a plan
      // can only ever schedule products that are allowed in its own season.
      const entries: {
        plannedDate: Date;
        inputSeasonId: string | null;
        quantity?: number;
        notes?: string;
      }[] = [];
      for (const e of dto.entries) {
        entries.push({
          plannedDate: new Date(e.plannedDate),
          inputSeasonId: await this.resolveInputSeasonId(
            e.productId,
            seasonId,
            tx,
          ),
          quantity: e.quantity,
          notes: e.notes,
        });
      }

      if (dto.locations && dto.locations.length > 0) {
        await this.assertLocationsUseable(dto.locations, seasonId, tx);
      }

      const plan = await tx.cropCarePlan.create({
        data: {
          seasonId,
          planType: dto.planType,
          name: dto.name,
          locations: dto.locations
            ? {
                create: dto.locations.map((l) => ({
                  targetType: l.targetType,
                  tunnelId: l.tunnelId,
                  sectorId: l.sectorId,
                })),
              }
            : undefined,
          entries: { create: entries },
        },
        include: {
          locations: { include: { tunnel: true, sector: true } },
          entries: { include: { inputSeason: INPUT_SEASON } },
        },
      });

      return { ...plan, entries: this.flattenInputSeasons(plan.entries) };
    });
  }

  async findAllPlans(q?: string, page?: string, pageSize?: string) {
    const seasonId = this.seasonService.getActiveSeasonId();
    const where = q
      ? {
          seasonId,
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { planType: { contains: q, mode: 'insensitive' as const } },
            { status: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : { seasonId };

    const include = {
      locations: { include: { tunnel: true, sector: true } },
      _count: { select: { entries: true } },
      entries: { select: { status: true } },
    };

    const pagination = getPaginationParams(page, pageSize);
    if (pagination) {
      const [total, plans] = await Promise.all([
        this.prismaService.cropCarePlan.count({ where }),
        this.prismaService.cropCarePlan.findMany({
          where,
          include,
          orderBy: { createdAt: 'desc' },
          skip: pagination.skip,
          take: pagination.take,
        }),
      ]);
      const items = this.withPlanProgress(plans);
      return {
        items,
        total,
        page: pagination.page,
        pageSize: pagination.pageSize,
        hasMore: pagination.page * pagination.pageSize < total,
      };
    }

    const plans = await this.prismaService.cropCarePlan.findMany({
      where,
      include,
      orderBy: { createdAt: 'desc' },
    });
    return this.withPlanProgress(plans);
  }

  private withPlanProgress(
    plans: Array<{
      _count: { entries: number };
      entries: { status: string }[];
    }>,
  ) {
    return plans.map((plan) => {
      const { _count, entries, ...rest } = plan;
      const executedCount = entries.filter(
        (e) => e.status === 'EXECUTED',
      ).length;
      const total = _count.entries;
      return {
        ...rest,
        entryCount: total,
        executedCount,
        progressPercent:
          total > 0 ? Math.round((executedCount / total) * 100) : 0,
      };
    });
  }

  async findPendingEntries() {
    const seasonId = this.seasonService.getActiveSeasonId();

    const entries = await this.prismaService.cropCarePlanEntry.findMany({
      // Through the plan: an entry is a child table with no season of its own.
      where: { status: 'PLANNED', plan: { seasonId } },
      orderBy: { plannedDate: 'asc' },
      include: {
        plan: { select: { id: true, name: true, planType: true } },
        inputSeason: INPUT_SEASON,
      },
    });
    return this.flattenInputSeasons(entries);
  }

  async findPlanById(id: string) {
    const plan = await this.prismaService.cropCarePlan.findUnique({
      where: { id },
      include: {
        locations: { include: { tunnel: true, sector: true } },
        entries: {
          orderBy: { plannedDate: 'asc' },
          include: {
            inputSeason: INPUT_SEASON,
            operation: { include: { locations: true } },
          },
        },
      },
    });
    if (!plan) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }
    return { ...plan, entries: this.flattenInputSeasons(plan.entries) };
  }

  /**
   * Move a plan through its three states: DRAFT → ACTIVE → COMPLETED.
   *
   * The route used to accept any status at all (CROP-04): a plan could jump
   * from DRAFT to COMPLETED, and anyone with `crop-care.edit` could pull one
   * back out of COMPLETED. It now follows the rules the sowing plans follow
   * (SPLAN-03, decision 6) — completing needs every entry done, and only an
   * administrator may reopen a completed plan, because completing it says the
   * season's work was done and reopening contradicts that.
   */
  async updatePlanStatus(id: string, status: string, isAdmin: boolean) {
    const plan = await this.findPlanById(id);

    if (status === 'COMPLETED') {
      const outstanding = await this.prismaService.cropCarePlanEntry.count({
        where: { planId: id, status: { not: 'EXECUTED' } },
      });

      if (outstanding > 0) {
        throw new ConflictException(
          `This plan still has ${outstanding} ${outstanding === 1 ? 'entry' : 'entries'} to execute. Execute them or delete them first.`,
        );
      }
    }

    if (plan.status === 'COMPLETED' && status !== 'COMPLETED') {
      if (!isAdmin) {
        throw new ForbiddenException(ERROR_MESSAGES.adminOnly);
      }

      if (status !== 'ACTIVE') {
        throw new BadRequestException(
          'A completed plan can only be reopened to Active.',
        );
      }
    }

    return this.prismaService.cropCarePlan.update({
      where: { id },
      data: { status },
    });
  }

  async deletePlan(id: string) {
    await this.findPlanById(id);
    return this.prismaService.cropCarePlan.delete({ where: { id } });
  }

  async addPlanEntry(
    planId: string,
    dto: {
      plannedDate: string;
      productId?: string;
      quantity?: number;
      notes?: string;
    },
  ) {
    // Resolved against the PLAN's season, never the open one: you may be adding
    // an entry to a plan from a season that is no longer the current one.
    const plan = await this.findPlanById(planId);

    const entry = await this.prismaService.cropCarePlanEntry.create({
      data: {
        planId,
        plannedDate: new Date(dto.plannedDate),
        inputSeasonId: await this.resolveInputSeasonId(
          dto.productId,
          plan.seasonId,
        ),
        quantity: dto.quantity,
        notes: dto.notes,
      },
      include: { inputSeason: INPUT_SEASON },
    });
    return this.flattenInputSeason(entry);
  }

  async deletePlanEntry(entryId: string) {
    const entry = await this.prismaService.cropCarePlanEntry.findUnique({
      where: { id: entryId },
      include: { operation: true },
    });
    if (!entry) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }

    // An executed entry has an operation behind it, and the relation is
    // `SetNull`: deleting the entry left the operation pointing at nothing while
    // still saying `source: 'PLAN'` — work nobody could trace back to a plan,
    // and an entry that could never be executed again (CROP-02).
    if (entry.operation) {
      throw new ConflictException(
        'This plan entry has already been executed. Delete the operation first if it was logged by mistake.',
      );
    }

    return this.prismaService.cropCarePlanEntry.delete({
      where: { id: entryId },
    });
  }

  /**
   * Execute a planned care entry → creates a CropOperation (source = PLAN).
   * Locations default to the plan's scope, but can be overridden at execution
   * time (multi-select grid).
   */
  async executePlanEntry(
    entryId: string,
    dto: ExecutePlanEntryDto,
    actor: Actor,
  ) {
    const entry = await this.prismaService.cropCarePlanEntry.findUnique({
      where: { id: entryId },
      include: { plan: { include: { locations: true } } },
    });
    if (!entry) {
      throw new NotFoundException(ERROR_MESSAGES.recordNotFound);
    }
    // A state refusal, not a bad request: the entry is fine, it has simply been
    // done already (CROP-03). 409 is what the rest of the app uses for this.
    if (entry.status === 'EXECUTED') {
      throw new ConflictException(
        'This plan entry has already been executed. Refresh the page to see it.',
      );
    }

    // A plan marked complete is closed for work until somebody reopens it — the
    // same rule the sowing plans follow (CROP-04, decision 6).
    if (entry.plan.status === 'COMPLETED') {
      throw new ConflictException(
        'This plan is marked complete. Reopen it before executing an entry.',
      );
    }

    const quantity = dto.quantity ?? entry.quantity ?? null;

    // The same rule as a standalone treatment (decision 1b): an entry that names
    // a product has to say how much was used — here, or on the entry itself.
    if (entry.inputSeasonId && !(quantity && quantity > 0)) {
      throw new BadRequestException(
        'Enter how much was used before executing this entry.',
      );
    }

    let locations: LocationDto[];
    if (dto.locations && dto.locations.length > 0) {
      locations = dto.locations;
    } else {
      locations = entry.plan.locations.map((l) => ({
        targetType: l.targetType as 'TUNNEL' | 'SECTOR',
        tunnelId: l.tunnelId ?? undefined,
        sectorId: l.sectorId ?? undefined,
      }));
    }

    // A treatment has to say where it was applied (decision 1a, 2026-09-29) —
    // and, per the same decision refined that day, so does everything else:
    // this now matches `createOperation` exactly, which has always refused an
    // operation with no location. The two paths disagreed until now, and a
    // location-less treatment can never appear in the compliance matrix, which
    // is keyed on locations.
    //
    // ⚠️ The practical consequence: executing *any* entry needs either a plan
    // with a scope or a `locations` array on the request.
    if (locations.length === 0) {
      throw new BadRequestException(
        'Choose at least one tunnel or sector before executing this entry.',
      );
    }

    // The plan's season, because that is the season the operation is filed into
    // (CROP-01) — a location from another season is not a place it happened.
    await this.assertLocationsUseable(locations, entry.plan.seasonId);

    // The operation date has to belong to the season it is filed into
    // (SEASON-08), and that season is the **plan's** (CROP-01), not the open one:
    // an entry from an older season consumes its own season's stock, so filing
    // the operation in the open season put the treatment in one season and the
    // chemical it used in another.
    await this.seasonService.assertDateInSeason(
      new Date(dto.performedAt),
      'operation date',
      entry.plan.seasonId,
    );

    return this.prismaService.$transaction(async (tx) => {
      // Claim the entry first, in a single statement (CROP-03). The guard above
      // is a read, so two requests arriving together both pass it; this update
      // is what actually decides, and it decides inside the transaction that
      // also writes the operation and takes the stock out — so a refused claim
      // rolls back the whole thing, stock included.
      const claimed = await tx.cropCarePlanEntry.updateMany({
        where: { id: entry.id, status: { not: 'EXECUTED' } },
        data: {
          status: 'EXECUTED',
          executedAt: new Date(),
          executedBy: actor.id,
        },
      });

      if (claimed.count === 0) {
        throw new ConflictException(
          'This plan entry has already been executed. Refresh the page to see it.',
        );
      }

      const operation = await tx.cropOperation.create({
        data: {
          // The plan's season, matching the input row and the stock it deducts
          // from (CROP-01).
          seasonId: entry.plan.seasonId,
          operationType: entry.plan.planType,
          // The entry already names its season's row — nothing to resolve.
          inputSeasonId: entry.inputSeasonId,
          source: 'PLAN',
          planEntryId: entry.id,
          quantity: quantity ?? undefined,
          performedAt: new Date(dto.performedAt),
          notes: dto.notes ?? entry.notes,
          createdBy: actor.id,
          locations: {
            create: locations.map((l) => ({
              targetType: l.targetType,
              tunnelId: l.tunnelId,
              sectorId: l.sectorId,
            })),
          },
        },
        include: { locations: true, inputSeason: INPUT_SEASON },
      });

      if (operation.inputSeasonId && quantity) {
        await this.consumeAgriInput(
          tx,
          operation.inputSeasonId,
          quantity,
          operation.id,
          operation.notes,
          actor.name,
        );
      }

      return this.flattenInputSeason(operation);
    });
  }
}
