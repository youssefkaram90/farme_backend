import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { MovementReason } from '../../common/enums/movement-reason.enum';

export class AdjustStockDto {
  /** The lot being adjusted — the row the user picked on the stock page. */
  @IsString()
  @IsNotEmpty()
  stockItemId!: string;

  /**
   * Signed on purpose: positive adds, negative removes.
   *
   * That way the reason only has to LABEL the movement, and the service can
   * check the sign against it — an opening balance can never be negative, a
   * write-off can never be positive. The stock page's add/remove toggle is what
   * produces the sign, so the user never types a minus.
   */
  @IsNumber()
  quantity!: number;

  @IsEnum(MovementReason)
  reason!: MovementReason;

  @IsOptional()
  @IsString()
  note?: string;
}
