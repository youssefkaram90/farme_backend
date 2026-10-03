import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { ERROR_MESSAGES } from '../../common/error-messages';
import { UserRole } from '../../users/enums/userRole.enum';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prismaService: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no permissions are required, allow access
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      // 401, not 403: there is nobody signed in to forbid. 403 means "signed in,
      // not allowed" — which is the `notAllowed` case below (X-05).
      throw new UnauthorizedException(ERROR_MESSAGES.notSignedIn);
    }

    // ADMIN role bypasses all permission checks — the enum rather than a literal,
    // so renaming a value cannot silently remove the bypass (PERM-05).
    if (user.role === UserRole.ADMIN) {
      return true;
    }

    // One indexed query per guarded request, on purpose (PERM-04).
    //
    // A cache — even a short-TTL one — would buy time this app cannot measure, and
    // pay for it with a window in which a permission that was just revoked still
    // works. Worse, if the backend is ever run as more than one instance, each
    // instance would keep its own opinion of who may do what. Re-reading the truth
    // every time is the cheaper mistake.
    const userPermissions = await this.prismaService.userPermission.findMany({
      where: { userId: user.id },
      include: { permission: true },
    });

    const userPermissionNames = userPermissions.map((up) => up.permission.name);

    // Check if the user has ALL required permissions
    const hasAllPermissions = requiredPermissions.every((permission) =>
      userPermissionNames.includes(permission),
    );

    if (!hasAllPermissions) {
      throw new ForbiddenException(ERROR_MESSAGES.notAllowed);
    }

    return true;
  }
}
