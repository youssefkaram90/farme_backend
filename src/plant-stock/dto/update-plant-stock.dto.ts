import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdatePlantStockDto {
  /**
   * One of `PLANT_STAGES` (`plant-stock.constants.ts`) — checked in the service,
   * not here, so the refusal reads as a sentence with the choices in it rather
   * than the pipe's generic "invalid data" (PSTOCK-05).
   */
  @IsOptional()
  @IsString()
  currentStage?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  expectedPlants?: number;
}
