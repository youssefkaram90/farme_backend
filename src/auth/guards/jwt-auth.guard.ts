import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ERROR_MESSAGES } from '../../common/error-messages';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  /**
   * Answering a missing or expired token with the bare word `Unauthorized` is
   * Nest's default, and it is not a sentence a non-technical user should meet —
   * yet every expired session lands here (AUTH-10).
   */
  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser | false | null | undefined,
  ): TUser {
    if (err instanceof Error) {
      throw err;
    }
    if (!user) {
      throw new UnauthorizedException(ERROR_MESSAGES.notSignedIn);
    }

    // Passport hands back whatever the strategy returned; `!user` above is the
    // check, so this is only a cast for the return type.
    return user;
  }
}
