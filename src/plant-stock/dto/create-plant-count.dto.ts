import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { NormalizeName } from '../../common/normalize-name';
import { ROWS_PER_LINE } from '../../common/sowing.constants';

export enum PlantCountType {
  /** SSM — whole trays sampled inside one tunnel. */
  TRAY = 'TRAY',
  /** LPM — 1-metre stretches sampled one row at a time, per line. */
  ROW_METRE = 'ROW_METRE',
}

export class CreatePlantCountDto {
  @IsEnum(PlantCountType)
  countType!: PlantCountType;

  /**
   * SSM: number of trays inspected.
   * LPM: number of 1-metre samples taken — a sample is always one metre of one
   * row, so this doubles as the row-metres covered. Not a fixed figure: as many
   * as the operator judges necessary.
   */
  @IsInt()
  @Min(1)
  sampleSize!: number;

  /**
   * Plants present in the sample. Supply exactly one of this and
   * `missingPlants` — when gaps are counted the plants are derived from the
   * seeds expected in the sample.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  countedPlants?: number;

  /** Gaps found in the sample. Mutually exclusive with `countedPlants`. */
  @IsOptional()
  @IsInt()
  @Min(0)
  missingPlants?: number;

  /**
   * SSM only — the tunnel that was counted. A sowing batch can be spread over
   * several tunnels, and each must be counted on its own.
   */
  @IsOptional()
  @IsString()
  location?: string;

  /** LPM only — which line of the sowing was sampled (1..lines). */
  @IsOptional()
  @IsInt()
  @Min(1)
  line?: number;

  /**
   * LPM only — how many of the rows were covered. The operator takes at least
   * one sample per row, so this can never exceed `sampleSize`.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(ROWS_PER_LINE)
  rowsInspected?: number;

  @NormalizeName()
  @IsOptional()
  @IsString()
  notes?: string;
}
