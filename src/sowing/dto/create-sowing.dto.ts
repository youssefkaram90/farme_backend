import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { FieldLocation } from '../enums/field-location.enum';
import { ProductType } from '../../deliveries/enums/product-type.enum';
import { StockType } from '../../deliveries/enums/stock-type.enum';
import { Type } from 'class-transformer';

export class CreateSowingDto {
  @IsString()
  @IsNotEmpty()
  cropType!: string;

  @Type(() => Date)
  sowingDate!: Date;

  @IsEnum(FieldLocation)
  greenhouse!: FieldLocation;

  @IsString()
  @IsNotEmpty()
  lotNumber!: string;

  @IsEnum(ProductType)
  productType!: ProductType;

  @IsEnum(StockType)
  stockType!: StockType;

  @IsNumber()
  quantityUsed!: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}
