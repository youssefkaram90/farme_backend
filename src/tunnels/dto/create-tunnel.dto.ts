import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTunnelDto {
  @IsString()
  @IsNotEmpty()
  number!: string;

  @IsOptional()
  @IsString()
  location?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacity!: number;
}
