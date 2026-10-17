import {
  IsDate,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { StockType } from '../../deliveries/enums/stock-type.enum';
import { NormalizeName } from '../../common/normalize-name';

export class ExecuteSSMDto {
  @IsUUID()
  planId!: string;

  @IsOptional()
  @IsUUID()
  planEntryId?: string;

  @IsOptional()
  @IsUUID()
  tunnelId?: string;

  @NormalizeName()
  @IsString()
  @IsNotEmpty()
  variety!: string;

  /**
   * Batch code (SSM) — stored separately; variety stays plain. Display as "variety <code>".
   *
   * Required, because `SowingSSM.code` is a required `Int` (SSM-02). It used to be
   * `@IsOptional()`, so a sowing saved without one reached Prisma and failed there:
   * a database error for what is really a missing field on the form.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  code!: number;

  @IsString()
  @IsNotEmpty()
  lotNumber!: string;

  @IsOptional()
  @IsEnum(StockType)
  stockType?: StockType;

  /**
   * The peat pool this sowing takes from — both halves of its key.
   *
   * Peat used to be a single pool, so nobody was asked: the server deducted
   * from `PEAT`/`GENERIC` whatever the form said. Peat is tracked per lot now
   * (decided 2026-10-05), so the operator picks the lot, exactly as they already
   * pick the seeds lot above.
   *
   * Required — every SSM sowing uses peat. The stock type is required with it
   * because a pool is identified by lot number AND stock type, and the row has
   * to remember which one to give the peat back to.
   */
  @IsString()
  @IsNotEmpty()
  peatLotNumber!: string;

  @IsEnum(StockType)
  peatStockType!: StockType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  numberOfTrays!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  seedsPerTray?: number;

  @Type(() => Date)
  @IsDate()
  sowingDate!: Date;

  @NormalizeName()
  @IsOptional()
  @IsString()
  remarks?: string;
}
