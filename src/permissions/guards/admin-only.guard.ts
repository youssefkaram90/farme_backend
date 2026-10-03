import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ERROR_MESSAGES } from '../../common/error-messages';
import { UserRole } from '../../users/enums/userRole.enum';

type RequestWithUser = { user?: { role?: string } };

/**
 * Restricts a route to ADMIN users only.
 *
 * Use this for actions that must NEVER be delegated through the permission
 * matrix — creating users and changing roles. Unlike PermissionsGuard there is
 * no escape hatch: ADMIN is the only role that passes.
 */
@Injectable()
export class AdminOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      // 401: nobody is signed in, so there is no role to refuse (X-05).
      throw new UnauthorizedException(ERROR_MESSAGES.notSignedIn);
    }

    // The enum rather than the literal `'ADMIN'` — a rename must not be able to
    // remove the admin bypass quietly (PERM-05).
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException(ERROR_MESSAGES.adminOnly);
    }

    return true;
  }
}
