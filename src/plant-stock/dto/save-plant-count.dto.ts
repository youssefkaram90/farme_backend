import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { NormalizeName } from '../../common/normalize-name';

export enum PlantCountType {
  /** SSM — whole trays sampled inside one tunnel. */
  TRAY = 'TRAY',
  /** LPM — 1-metre stretches sampled one row at a time, per line. */
  ROW_METRE = 'ROW_METRE',
}

/** One reading: what the operator found in ONE sample. */
export class PlantCountSampleDto {
  /**
   * LPM only — the line this reading came from (1..lines). Refused for trays,
   * which belong to no line.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  line?: number;

  /**
   * Plants present in THIS sample. Supply exactly one of this and
   * `missingPlants` — when gaps are counted the plants follow from the seeds this
   * one sample was sown with.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  countedPlants?: number;

  /** Gaps found in THIS sample. Mutually exclusive with `countedPlants`. */
  @IsOptional()
  @IsInt()
  @Min(0)
  missingPlants?: number;
}

/**
 * The readings for one count (PSTOCK-24). Sent whole — this is what the count IS.
 */
export class SavePlantCountDto {
  @IsEnum(PlantCountType)
  countType!: PlantCountType;

  /**
   * SSM only — the tunnel that was counted. A sowing batch can be spread over
   * several tunnels, and each must be counted on its own: together with the
   * batch's id this is the KEY a count is found by, so a batch in two tunnels has
   * one count per tunnel.
   */
  @IsOptional()
  @IsString()
  location?: string;

  /**
   * The readings, in the order they were taken — ONE per sample: a tray (SSM) or
   * one metre of one row (LPM).
   *
   * The list is the COMPLETE set, not an addition (PSTOCK-24 → PUT, decided
   * 2026-10-11): the count IS its readings, so adding one, correcting a typo and
   * deleting one are all the same act — save the list.
   *
   * A blank row is not a reading: the screens send only the filled ones.
   */
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PlantCountSampleDto)
  samples!: PlantCountSampleDto[];

  @NormalizeName()
  @IsOptional()
  @IsString()
  notes?: string;
}
