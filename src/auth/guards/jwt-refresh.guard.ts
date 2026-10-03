import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ERROR_MESSAGES } from '../../common/error-messages';

@Injectable()
export class JwtRefreshAuthGuard extends AuthGuard('jwt-refresh') {
  /**
   * Same reason as `JwtAuthGuard`: an expired or absent refresh token must reach
   * the client as a sentence, not as the bare word `Unauthorized` (AUTH-10).
   */
  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser | false | null | undefined,
    _info: unknown,
    _context: ExecutionContext,
    _status?: unknown,
  ): TUser {
    if (err || !user) {
      throw err ?? new UnauthorizedException(ERROR_MESSAGES.notSignedIn);
    }

    return user as TUser;
  }
}
