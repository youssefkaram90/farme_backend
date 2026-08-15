import { IsBase64, IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { PlanType } from '../enums/plan-type.enum';

export class ImportPlanExcelDto {
  @IsEnum(PlanType)
  planType!: PlanType;

  @IsString()
  @IsNotEmpty()
  name!: string;

  /** Base64-encoded Excel file (.xlsx) */
  @IsString()
  @IsNotEmpty()
  excelBase64!: string;
}
