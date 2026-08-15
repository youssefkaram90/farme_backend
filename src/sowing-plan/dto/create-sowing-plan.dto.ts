import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { PlanType } from '../enums/plan-type.enum';

export class CreateSowingPlanDto {
  @IsEnum(PlanType)
  planType!: PlanType;

  @IsString()
  @IsNotEmpty()
  name!: string;
}
