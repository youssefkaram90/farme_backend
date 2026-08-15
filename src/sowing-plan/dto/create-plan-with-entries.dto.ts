import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { PlanType } from '../enums/plan-type.enum';
import { CreatePlanEntryDto } from './create-plan-entry.dto';

export class CreatePlanWithEntriesDto {
  @IsEnum(PlanType)
  planType!: PlanType;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  sectorId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePlanEntryDto)
  entries!: CreatePlanEntryDto[];
}
