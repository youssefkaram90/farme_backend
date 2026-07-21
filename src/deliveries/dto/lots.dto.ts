import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ProductType } from '../enums/product-type.enum';

export class LotsDto {
  @IsString()
  @IsNotEmpty()
  lotNumber!: string;

  @IsNumber()
  quantity!: number;

  @IsOptional()
  @IsNumber()
  thousandSeedsPerGram?: number;

  @IsEnum(ProductType)
  productType!: ProductType;

  @IsString()
  @IsNotEmpty()
  supplierName!: string;

  @IsOptional()
  @IsString()
  remark?: string;
}