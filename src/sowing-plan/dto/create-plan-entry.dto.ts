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

export class CreatePlanEntryDto {
  @IsString()
  @IsNotEmpty()
  variety!: string;

  @IsEnum(StockType)
  stockType!: StockType;

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
  @IsString()
  lines?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  metersPerLine?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  seedsPerMeter?: number;
}
