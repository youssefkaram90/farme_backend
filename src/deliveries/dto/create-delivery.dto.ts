import {
  ArrayMinSize,
  IsArray,
  ValidateNested,
  IsDateString,
  IsString,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { NormalizeName } from '../../common/normalize-name';
import { LotsDto } from './lots.dto';

export class CreateDeliveryDto {
  @IsDateString()
  deliveryDate!: string;

  @IsString()
  @IsNotEmpty()
  deliveryCode!: string;

  @NormalizeName()
  @IsNotEmpty()
  @IsString()
  transport!: string;

  // At least one lot, or the delivery records nothing: an empty array used to
  // pass validation and create a delivery with no lots at all (DELIV-05).
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LotsDto)
  lots!: LotsDto[];
}
