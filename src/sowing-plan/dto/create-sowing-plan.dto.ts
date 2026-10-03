import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PlanType } from '../enums/plan-type.enum';
import { NormalizeName } from '../../common/normalize-name';

export class CreateSowingPlanDto {
  @IsEnum(PlanType)
  planType!: PlanType;

  @NormalizeName()
  @IsString()
  @IsNotEmpty()
  name!: string;

  /** Optional: the plan name only has to be unique within a location. */
  @NormalizeName()
  @IsOptional()
  @IsString()
  location?: string;
}
