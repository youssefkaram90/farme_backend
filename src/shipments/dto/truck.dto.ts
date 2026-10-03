import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { NormalizeName, NormalizePlate } from '../../common/normalize-name';

/**
 * The same decorators tunnels and sectors use (TRUCK-03), plus `NormalizePlate`
 * for the two plate fields (TRUCK-02): a name is capitalized, a plate is
 * uppercased and its spacing tidied, so `ab-12-cd` and `AB-12-CD` can no longer
 * become two trailers.
 */
export class CreateTruckDto {
  @NormalizeName()
  @IsString()
  @IsNotEmpty()
  name!: string;

  /** Required — every trailer has a plate. */
  @NormalizePlate()
  @IsString()
  @IsNotEmpty()
  trailerPlateNumber!: string;

  /** Optional — the tractor unit can change between trips. */
  @NormalizePlate()
  @IsOptional()
  @IsString()
  truckPlateNumber?: string;
}

export class UpdateTruckDto {
  @NormalizeName()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @NormalizePlate()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  trailerPlateNumber?: string;

  @NormalizePlate()
  @IsOptional()
  @IsString()
  truckPlateNumber?: string;
}
