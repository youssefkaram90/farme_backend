import { Type } from 'class-transformer';
import {
  IsString,
  IsInt,
  Min,
  IsArray,
  ValidateNested,
  IsDateString,
  IsOptional,
} from 'class-validator';

export class TunnelAssignmentEntryDto {
  @IsString()
  ssmSowingId!: string;

  @IsString()
  tunnelId!: string;

  @IsInt()
  @Min(1)
  numberOfTrays!: number;
}

export class CreateTunnelAssignmentsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TunnelAssignmentEntryDto)
  assignments!: TunnelAssignmentEntryDto[];

  @IsOptional()
  @IsDateString()
  transportDate?: string;
}

export class UpdateTunnelAssignmentDto {
  @IsInt()
  @Min(1)
  numberOfTrays!: number;
}
