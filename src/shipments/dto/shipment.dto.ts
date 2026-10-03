import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateShipmentLineDto {
  /** The finished-goods product being shipped. */
  @IsUUID()
  harvestedProductId!: string;

  /** How many boxes. */
  @IsInt()
  @Min(1)
  boxCount!: number;

  /**
   * Plants in each box. Accepted but IGNORED — the box size belongs to the
   * finished-goods product (a 410 box and a 430 box of the same batch are
   * separate stock lines), so the server always uses the product's own value.
   * Optional exactly so an older client that still sends it does not get a 400.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  plantsPerBox?: number;
}

export class CreateShipmentDto {
  /**
   * Not normalised on purpose: a shipment number like "SHP-0012" must survive
   * exactly as typed.
   */
  @IsString()
  @IsNotEmpty()
  shipmentNumber!: string;

  @IsDateString()
  shipmentDate!: string;

  /** The truck carrying the shipment — chosen from the truck list. */
  @IsUUID()
  truckId!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one product to the shipment.' })
  @ValidateNested({ each: true })
  @Type(() => CreateShipmentLineDto)
  lines!: CreateShipmentLineDto[];
}
