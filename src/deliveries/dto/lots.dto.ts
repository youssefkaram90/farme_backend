import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { ProductType } from '../enums/product-type.enum';
import { StockType } from '../enums/stock-type.enum';

export class LotsDto {
  @IsString()
  @IsNotEmpty()
  lotNumber!: string;

    @IsEnum(StockType)
    stockType!: StockType;

  @IsNumber()
  quantity!: number;

  @IsOptional()
  @IsNumber()
  thousandSeedsPerGram?: number;

  @IsEnum(ProductType)
  productType!: ProductType;

  @IsString()
  @IsNotEmpty()
  productName!: string;

  @IsString()
  @IsNotEmpty()
  supplierName!: string;

  @IsOptional()
  @IsString()
  remark?: string;
}
