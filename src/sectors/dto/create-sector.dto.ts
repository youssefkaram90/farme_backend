import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { NormalizeName } from '../../common/normalize-name';

export class CreateSectorDto {
  @NormalizeName()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @NormalizeName()
  @IsOptional()
  @IsString()
  location?: string;
}
