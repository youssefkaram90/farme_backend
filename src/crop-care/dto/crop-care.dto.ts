import {
  IsArray,
  ValidateNested,
  IsDateString,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsUUID,
  IsNumber,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { NormalizeName } from '../../common/normalize-name';

// -------------------------------------------------------------------
// Locations (tunnels / sectors)
// -------------------------------------------------------------------

export class LocationDto {
  @IsIn(['TUNNEL', 'SECTOR'])
  targetType!: 'TUNNEL' | 'SECTOR';

  @IsOptional()
  @IsUUID()
  tunnelId?: string;

  @IsOptional()
  @IsUUID()
  sectorId?: string;
}

// -------------------------------------------------------------------
// Phytosanitary products
// -------------------------------------------------------------------

export class CreatePhytosanitaryProductDto {
  @NormalizeName()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @NormalizeName()
  @IsOptional()
  @IsString()
  activeIngredient?: string;

  @NormalizeName()
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @NormalizeName()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdatePhytosanitaryProductDto {
  @NormalizeName()
  @IsOptional()
  @IsString()
  name?: string;

  @NormalizeName()
  @IsOptional()
  @IsString()
  activeIngredient?: string;

  @NormalizeName()
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @NormalizeName()
  @IsOptional()
  @IsString()
  notes?: string;
}

// -------------------------------------------------------------------
// Phytosanitary program (the "must-use before harvest" list)
// -------------------------------------------------------------------

export class CreatePhytosanitaryProgramDto {
  @NormalizeName()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @NormalizeName()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdatePhytosanitaryProgramDto {
  @NormalizeName()
  @IsOptional()
  @IsString()
  name?: string;

  @NormalizeName()
  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** Replace the program's required products with this list */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productIds?: string[];
}

// -------------------------------------------------------------------
// Crop operations (standalone log)
// -------------------------------------------------------------------

export class CreateCropOperationDto {
  @IsIn(['IRRIGATION', 'TREATMENT', 'FERTILISATION'])
  operationType!: 'IRRIGATION' | 'TREATMENT' | 'FERTILISATION';

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsDateString()
  performedAt!: string;

  @NormalizeName()
  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LocationDto)
  locations!: LocationDto[];
}

// -------------------------------------------------------------------
// Crop care plans
// -------------------------------------------------------------------

export class CreatePlanEntryDto {
  @IsDateString()
  plannedDate!: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @NormalizeName()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateCropCarePlanDto {
  @IsIn(['IRRIGATION', 'TREATMENT', 'FERTILISATION'])
  planType!: 'IRRIGATION' | 'TREATMENT' | 'FERTILISATION';

  @NormalizeName()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LocationDto)
  locations?: LocationDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePlanEntryDto)
  entries!: CreatePlanEntryDto[];
}

export class UpdatePlanStatusDto {
  @IsIn(['DRAFT', 'ACTIVE', 'COMPLETED'])
  status!: 'DRAFT' | 'ACTIVE' | 'COMPLETED';
}

export class ExecutePlanEntryDto {
  @IsDateString()
  performedAt!: string;

  /** Overrides the plan's default locations — multi-select at execution time */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LocationDto)
  locations?: LocationDto[];

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @NormalizeName()
  @IsOptional()
  @IsString()
  notes?: string;
}
