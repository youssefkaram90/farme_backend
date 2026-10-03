import { IsIn, IsOptional, IsString } from 'class-validator';
import { MovementReason } from '../../common/enums/movement-reason.enum';

/**
 * The reasons that mean anything for boxes of finished goods (HARV-05).
 *
 * The field used to accept the whole `MovementReason` enum, which also holds
 * reasons describing stock arriving (`RECEIVED`), a season's opening count
 * (`OPENING`) and a chemical being used up (`USED`) — none of which a write-off
 * of spoiled plants can be. The web form has only ever offered these three; the
 * API now says the same instead of trusting every caller to know.
 */
const WRITE_OFF_REASONS = [
  MovementReason.RETURNED_TO_CLIENT,
  MovementReason.WASTE,
  MovementReason.CORRECTION,
] as const;

export class WriteOffHarvestDto {
  /**
   * WHY the boxes are being written off — required on purpose. It is the only
   * record of what happened to them, and the number that tells spoilage apart
   * from a counting error.
   */
  @IsIn(WRITE_OFF_REASONS)
  reason!: MovementReason;

  @IsOptional()
  @IsString()
  note?: string;
}
