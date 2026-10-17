import {
  IsDate,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { StockType } from '../../deliveries/enums/stock-type.enum';
import { NormalizeName } from '../../common/normalize-name';

export class CreatePlanEntryDto {
  @NormalizeName()
  @IsString()
  @IsNotEmpty()
  variety!: string;

  @IsEnum(StockType)
  stockType!: StockType;

  @NormalizeName()
  @IsOptional()
  @IsString()
  peat?: string;

  @Type(() => Date)
  @IsDate()
  plannedDate!: Date;

  // --- SSM fields ---
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  plannedTrays?: number;

  // --- LPM fields ---
  /**
   * DERIVED for a field (LPM) line, from the density the farm plans at, the lines
   * and the metres per line (decided 2026-10-11). Anything sent here is ignored —
   * the planner types no seed total. It is still required and stored for a tunnel
   * (SSM) line, where it is the trays x seeds per tray that the plan compares
   * against.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  plannedQuantity?: number;

  @IsOptional()
  @IsUUID()
  sectorId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lines?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  metersPerLine?: number;

  /**
   * The density the line was PLANNED at, in seeds per row-metre — the figure the
   * plan's seed total was worked out from, stored so a plan made today still says
   * what it was planned with if the farm changes the setting tomorrow.
   *
   * Derived server-side; a client that still sends it does not fail validation
   * (kept whitelisted), but the value it sends is ignored.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  seedsPerMeter?: number;

  @NormalizeName()
  @IsOptional()
  @IsString()
  remark?: string;
}
