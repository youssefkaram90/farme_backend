import { IsOptional, IsString } from 'class-validator';

export class CloseSeasonDto {
  /**
   * Which season to open once this one is closed:
   *
   * - `"next"` — the following season. It is created if it does not exist yet,
   *   so "open the next one" is always a valid choice.
   * - a season id — that season, as chosen by the administrator.
   * - omitted or `null` — open nothing. The app then has no open season, and
   *   every new record is refused until an administrator opens one.
   *
   * Only "is a string" is checked here; the service decides whether the value
   * names a season, so the user gets ONE plain sentence instead of the generic
   * validation wording.
   */
  @IsOptional()
  @IsString()
  open?: string | null;
}
