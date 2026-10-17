import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ERROR_MESSAGES } from '../../common/error-messages';

/**
 * Guards `POST /auth/signin`.
 *
 * The `handleRequest` override matters as much as the one on `JwtAuthGuard`
 * (AUTH-10). passport-local answers a MISSING name or password itself, with
 * `{ message: 'Missing credentials' }, 400`; Nest's default ignores both the
 * message and the status and throws a bare `UnauthorizedException()`. So the one
 * auth failure a user can actually reach answered with the developer word
 * "Unauthorized" — and both clients print `message` verbatim (AUTH-15).
 *
 * Sign-in now has exactly ONE failure sentence, whatever arrived. A wrong
 * password, an unknown name and an empty field are deliberately
 * indistinguishable: there is nothing the client should tell apart, and nothing
 * the server should leak.
 */
@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {
  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser | false | null | undefined,
  ): TUser {
    if (err instanceof Error) {
      throw err;
    }

    if (err !== null && err !== undefined && err !== false) {
      throw new UnauthorizedException(ERROR_MESSAGES.invalidCredentials);
    }

    if (!user) {
      throw new UnauthorizedException(ERROR_MESSAGES.invalidCredentials);
    }

    return user;
  }
}
