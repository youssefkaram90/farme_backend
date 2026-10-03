import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { NormalizeName } from '../../common/normalize-name';

export class CreateTunnelDto {
  @NormalizeName()
  @IsString()
  @IsNotEmpty()
  number!: string;

  @NormalizeName()
  @IsOptional()
  @IsString()
  location?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacity!: number;
}
