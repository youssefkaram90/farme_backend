import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsUUID,
  IsInt,
  Min,
  IsDateString,
} from 'class-validator';
import { NormalizeName } from '../../common/normalize-name';

export class CreateHarvestRecordDto {
  @NormalizeName()
  @IsString()
  @IsNotEmpty()
  productName!: string;

  /**
   * The plant code printed on the box label. DERIVED server-side from the batch
   * — SSM: the batch's code; LPM: box size in hundreds + sector. Anything sent
   * here is ignored; the field is kept only so clients that still send it do
   * not fail validation.
   *
   * Deliberately NOT @NormalizeName(): a value like "12 Ha4-1" must survive
   * exactly as composed.
   */
  @IsOptional()
  @IsString()
  planteCode?: string;

  @IsIn(['TUNNEL', 'SECTOR'])
  targetType!: 'TUNNEL' | 'SECTOR';

  @IsOptional()
  @IsUUID()
  tunnelId?: string;

  @IsOptional()
  @IsUUID()
  sectorId?: string;

  /// 'CVT' | 'BIO' — SSM (tunnels) only; null for LPM (manual plants-per-box)
  @IsOptional()
  @IsIn(['CVT', 'BIO'])
  stockType?: string;

  @IsInt()
  @Min(1)
  boxCount!: number;

  @IsInt()
  @Min(1)
  plantsPerBox!: number;

  @IsDateString()
  harvestedAt!: string;

  /**
   * The sowing batch the plants came from. REQUIRED: without it a harvest
   * cannot be attributed to a variety and lot, so harvested-vs-remaining is
   * impossible to work out.
   *
   * The column stays nullable in the database because the link is declared
   * `onDelete: SetNull` — deleting a batch must not erase its harvest history.
   */
  @IsUUID()
  plantStockId!: string;
}
