import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PlanType } from '../enums/plan-type.enum';
import { NormalizeName } from '../../common/normalize-name';

export class ImportPlanExcelDto {
  @IsEnum(PlanType)
  planType!: PlanType;

  @NormalizeName()
  @IsString()
  @IsNotEmpty()
  name!: string;

  /**
   * Optional location for the imported plan. When provided, sector names in
   * the file are matched within that location, so the same sector name can
   * exist in several locations.
   */
  @NormalizeName()
  @IsOptional()
  @IsString()
  location?: string;

  /** Base64-encoded Excel file (.xlsx) */
  @IsString()
  @IsNotEmpty()
  excelBase64!: string;
}
