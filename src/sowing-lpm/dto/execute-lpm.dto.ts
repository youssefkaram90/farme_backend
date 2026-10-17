import {
  IsDate,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { StockType } from '../../deliveries/enums/stock-type.enum';
import { NormalizeName } from '../../common/normalize-name';

export class ExecuteLPMDto {
  @IsUUID()
  planId!: string;

  @IsOptional()
  @IsUUID()
  planEntryId?: string;

  @IsOptional()
  @IsUUID()
  /**
   * The sector the field sowing goes into. REQUIRED — checked in the service, not
   * here, so the refusal is a sentence rather than the pipe's generic "invalid
   * data" (PSTOCK-20 (i), decided 2026-10-10).
   */
  sectorId?: string;

  @NormalizeName()
  @IsString()
  @IsNotEmpty()
  variety!: string;

  @IsString()
  @IsNotEmpty()
  lotNumber!: string;

  @IsOptional()
  @IsEnum(StockType)
  stockType?: StockType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantityUsed!: number;

  @Type(() => Date)
  @IsDate()
  sowingDate!: Date;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lines?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  meterPerLine?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  seedsPerMeter?: number;

  @NormalizeName()
  @IsOptional()
  @IsString()
  remarks?: string;
}
