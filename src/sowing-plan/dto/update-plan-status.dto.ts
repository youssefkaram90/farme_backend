import { IsEnum } from 'class-validator';
import { PlanStatus } from '../enums/plan-type.enum';

export class UpdatePlanStatusDto {
  @IsEnum(PlanStatus, {
    message: 'Status must be DRAFT, IN_PROGRESS, or COMPLETED',
  })
  status!: PlanStatus;
}
