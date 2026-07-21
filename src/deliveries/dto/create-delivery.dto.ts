import { IsEnum, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { StockType } from '../enums/stock-type.enum';
import { LotsDto } from './lots.dto';

export class CreateDeliveryDto {
  @IsEnum(StockType)
  stockType!: StockType;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LotsDto)
  lots!: LotsDto[];
}