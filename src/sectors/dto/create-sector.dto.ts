import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateSectorDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  location?: string;
}
