import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { UserRole } from '../enums/userRole.enum';
import { NormalizeName } from '../../common/normalize-name';

export class CreateUserDto {
  /**
   * The person's name — and the name they sign in with, which is why it is
   * stored EXACTLY as typed (decided 2026-10-01, AUTH-12).
   *
   * It used to carry `@NormalizeName()`, so the create form turned `john` into
   * `John` while `SigninDto` compared the typed string character for character:
   * the account could then only be entered with a spelling the person typing had
   * never seen and could not guess.
   *
   * Do NOT add `@NormalizeName()` back. It is still the right decorator for name
   * fields that are only ever displayed or searched (tunnels, sectors, products,
   * plan names) — this one is a credential.
   */
  @IsNotEmpty()
  @IsString()
  name!: string;

  @IsNotEmpty()
  @IsString()
  password!: string;

  @NormalizeName()
  @IsOptional()
  @IsString()
  lastName?: string;

  @IsEnum(UserRole)
  role!: UserRole;
}
