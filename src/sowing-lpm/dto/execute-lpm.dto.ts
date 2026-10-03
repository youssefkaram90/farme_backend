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
