import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export enum PlantCountType {
  TRAY = 'TRAY',
  METER = 'METER',
}

export class CreatePlantCountDto {
  @IsEnum(PlantCountType)
  countType!: PlantCountType;

  @IsNumber()
  @Min(0.0001)
  sampleSize!: number;

  @IsInt()
  @Min(0)
  countedPlants!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
