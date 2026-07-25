import {IsArray, ValidateNested, IsDateString, IsString, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';
import { LotsDto } from './lots.dto';

export class CreateDeliveryDto {


  @IsDateString()
  deliveryDate!: string;

  @IsString()
  @IsNotEmpty()
  deliveryCode!:string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LotsDto)
  lots!: LotsDto[];
}
