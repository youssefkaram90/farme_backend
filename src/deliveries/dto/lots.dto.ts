import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import { ProductType } from '../enums/product-type.enum';
import { StockType } from '../enums/stock-type.enum';
import { NormalizeName } from '../../common/normalize-name';

export class LotsDto {
  @IsString()
  @IsNotEmpty()
  lotNumber!: string;

  /**
   * `BIO` or `CVT` — for seeds and for anything else that genuinely has
   * varieties.
   *
   * Not asked for on a PEAT lot: peat has no variety, it is one pool (see
   * `stock/pooled-lot.ts`), and requiring the field only to ignore it is how
   * `'GENERIC'` — a value that is not a `StockType` — reached the ledger
   * (DELIV-04).
   */
  @ValidateIf((lot: LotsDto) => lot.productType !== ProductType.PEAT)
  @IsEnum(StockType)
  stockType?: StockType;

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
