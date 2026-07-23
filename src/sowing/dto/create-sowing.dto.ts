import {
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { SowingType } from '../enums/field-location.enum';
import { ProductType } from '../../deliveries/enums/product-type.enum';
import { StockType } from '../../deliveries/enums/stock-type.enum';
import { Type } from 'class-transformer';

export class CreateSowingDto {
  @IsString()
  @IsNotEmpty()
  variety!: string;

  @Type(() => Date)
  @IsDate()
  sowingDate!: Date;

  @IsEnum(SowingType)
  sowingType!: SowingType;

  @IsString()
  @IsNotEmpty()
  lotNumber!: string;

  @IsEnum(ProductType)
  productType!: ProductType;

  @IsEnum(StockType)
  stockType!: StockType;

  @IsNumber()
  quantityUsed!: number;

  /// Number of trays (for GREENHOUSE only)
  @IsOptional()
  @IsNumber()
  @Min(1)
  numberOfTrays?: number;

  /// Seeds per tray (for GREENHOUSE only, defaults to 285)
  @IsOptional()
  @IsNumber()
  @Min(1)
  seedsPerTray?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}
