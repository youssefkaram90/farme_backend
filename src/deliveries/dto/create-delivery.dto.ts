import {IsArray, ValidateNested, IsDateString, IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { LotsDto } from './lots.dto';

export class CreateDeliveryDto {


  @IsDateString()
  deliveryDate!: string;

  @IsString()
  @IsNotEmpty()
  deliveryCode!:string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LotsDto)
  lots!: LotsDto[];
}
