import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ProductType } from '../enums/product-type.enum';
import { StockType } from '../enums/stock-type.enum';
import { NormalizeName } from '../../common/normalize-name';

export class LotsDto {
  @IsString()
  @IsNotEmpty()
  lotNumber!: string;

  /**
   * `BIO` or `CVT` — asked for on EVERY lot, peat included.
   *
   * Peat used to skip this field (`ValidateIf`) because all peat landed in one
   * `'GENERIC'` pool and a variety means nothing for peat. Peat is tracked per
   * lot now (decided 2026-10-05), so its stock type is part of the pool's
   * identity like any other — and the form has always shown the field anyway,
   * with `CVT` pre-selected, so requiring it asks for nothing new on screen.
   */
  @IsEnum(StockType)
  stockType!: StockType;

  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsNumber()
  thousandSeedsPerGram?: number;

  @IsEnum(ProductType)
  productType!: ProductType;

  @NormalizeName()
  @IsString()
  @IsNotEmpty()
  productName!: string;

  @NormalizeName()
  @IsString()
  @IsNotEmpty()
  supplierName!: string;
  @NormalizeName()
  @IsOptional()
  @IsString()
  remark?: string;
}
