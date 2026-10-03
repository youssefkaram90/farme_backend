import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { MovementReason } from '../../common/enums/movement-reason.enum';

/**
 * Put a catalogue product on this season's list.
 *
 * One action, two jobs, because the season row is both of them: it says
 * the product is allowed this season, and it is where that season's stock lives.
 */
export class AddAgriInputDto {
  /** The CATALOGUE product — the season row is created from it. */
  @IsString()
  @IsNotEmpty()
  productId!: string;

  /**
   * The leftover you counted at the start of the season, if any.
   *
   * Optional: adding a product you *intend* to use should not force you to
   * invent a quantity. Left out, the product starts at 0.
   */
  @IsOptional()
  @IsNumber()
  openingQuantity?: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class AdjustAgriInputDto {
  /**
   * Signed on purpose — positive adds, negative removes.
   *
   * Exactly the same convention as a seed/peat adjustment: the reason only has
   * to LABEL the movement, so the service can check the sign against it (an
   * opening balance can never be negative, a write-off can never be positive).
   * The add/remove toggle in the UI produces the sign, so the user never types a
   * minus.
   */
  @IsNumber()
  quantity!: number;

  /**
   * Any reason except `used` — consumption is written by the server when a
   * treatment is logged (P6-06), never picked by hand.
   */
  @IsEnum(MovementReason)
  reason!: MovementReason;

  @IsOptional()
  @IsString()
  note?: string;
}
