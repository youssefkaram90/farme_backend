import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AdminOnlyGuard } from './admin-only.guard';
import { ERROR_MESSAGES } from '../../common/error-messages';
import { UserRole } from '../../users/enums/userRole.enum';

/**
 * The ADMIN-only boundary (PERM-05 / X-05).
 *
 * Routes behind this guard — creating users, changing roles, closing a season —
 * can never be handed out through the permission matrix, so the only thing that
 * matters is that nothing except the ADMIN role gets past it.
 */

const contextFor = (user?: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

const guard = new AdminOnlyGuard();

describe('AdminOnlyGuard', () => {
  it('lets an ADMIN through', () => {
    expect(guard.canActivate(contextFor({ role: UserRole.ADMIN }))).toBe(true);
  });

  it('refuses a MANAGER with 403', () => {
    expect(() =>
      guard.canActivate(contextFor({ role: UserRole.MANAGER })),
    ).toThrow(ForbiddenException);

    expect(() =>
      guard.canActivate(contextFor({ role: UserRole.MANAGER })),
    ).toThrow(ERROR_MESSAGES.adminOnly);
  });

  it('refuses the plain USER role with 403', () => {
    expect(() =>
      guard.canActivate(contextFor({ role: UserRole.USER })),
    ).toThrow(ForbiddenException);
  });

  it('answers 401 when nobody is signed in', () => {
    expect(() => guard.canActivate(contextFor())).toThrow(
      UnauthorizedException,
    );

    expect(() => guard.canActivate(contextFor())).toThrow(
      ERROR_MESSAGES.notSignedIn,
    );
  });

  it('is not fooled by a lower-case role', () => {
    expect(() => guard.canActivate(contextFor({ role: 'admin' }))).toThrow(
      ForbiddenException,
    );
  });
});
