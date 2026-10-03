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

export class CreatePlanEntryDto {
  @NormalizeName()
  @IsString()
  @IsNotEmpty()
  variety!: string;

  @IsEnum(StockType)
  stockType!: StockType;

  @NormalizeName()
  @IsOptional()
  @IsString()
  peat?: string;

  @Type(() => Date)
  @IsDate()
  plannedDate!: Date;

  // --- SSM fields ---
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  plannedTrays?: number;

  // --- LPM fields ---
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  plannedQuantity?: number;

  @IsOptional()
  @IsUUID()
  sectorId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lines?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  metersPerLine?: number;

  /**
   * Derived server-side from plannedQuantity, lines and metersPerLine.
   * Anything sent here is ignored; the field is kept only so clients that still
   * send it do not fail validation.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  seedsPerMeter?: number;

  @NormalizeName()
  @IsOptional()
  @IsString()
  remark?: string;
}
