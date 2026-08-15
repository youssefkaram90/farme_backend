import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdatePlantStockDto {
  @IsOptional()
  @IsString()
  currentStage?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  expectedPlants?: number;
}
