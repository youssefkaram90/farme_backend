import { IsNotEmpty, IsString } from 'class-validator';

export class CreateSeasonDto {
  // Only "is a non-empty string" is checked here on purpose. The season-code
  // rules live in season-code.ts so the user gets ONE specific message
  // ('A season must look like "26-27".') instead of the generic
  // ERROR_MESSAGES.invalidData that class-validator failures produce.
  @IsString()
  @IsNotEmpty()
  code!: string;
}