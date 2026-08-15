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

export class ExecuteSSMDto {
  @IsUUID()
  planId!: string;

  @IsOptional()
  @IsUUID()
  planEntryId?: string;

  @IsOptional()
  @IsUUID()
  tunnelId?: string;

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
  numberOfTrays!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  seedsPerTray?: number;

  @Type(() => Date)
  @IsDate()
  sowingDate!: Date;

  @IsOptional()
  @IsString()
  remarks?: string;
}
