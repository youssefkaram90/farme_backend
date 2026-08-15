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

export class ExecuteLPMDto {
  @IsUUID()
  planId!: string;

  @IsOptional()
  @IsUUID()
  planEntryId?: string;

  @IsOptional()
  @IsUUID()
  sectorId?: string;

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

  @IsOptional()
  @IsString()
  remarks?: string;
}
