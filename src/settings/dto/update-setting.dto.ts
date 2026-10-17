import { IsDefined } from 'class-validator';

export class UpdateSettingDto {
  /**
   * The new value, as a form sends it (`"300"`) or as a client sends it (`300`).
   *
   * Deliberately loose: parsing and the whole-number / range checks belong to the
   * registry, which knows what each setting is. A blanket `@IsInt()` here would
   * answer a person on the settings page with the API's one generic "invalid data"
   * sentence instead of naming the field and its bounds (SOW-11).
   */
  @IsDefined()
  value!: number | string;
}
