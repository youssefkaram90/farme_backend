import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ERROR_MESSAGES } from '../common/error-messages';

@Injectable()
export class PermissionsService {
  constructor(private prismaService: PrismaService) {}

  /**
   * Get all available permissions in the system
   */
  async getAllPermissions() {
    return this.prismaService.permission.findMany({
      orderBy: { name: 'asc' },
    });
  }

  /**
   * The permissions assigned to one user.
   *
   * 404s for a user that does not exist: answering `[]` made "this user has no
   * permissions" and "you asked about nobody" look identical on the admin
   * screen (PERM-02).
   */
  async getUserPermissions(userId: string) {
    await this.assertUserExists(userId);

    return this.listPermissions(userId);
  }

  /**
   * Replace a user's permissions with exactly this list.
   *
   * Three things made this dangerous, and they compounded: the delete ran before
   * the insert as a SEPARATE statement, nothing checked that the ids still
   * existed, and `UserPermission` is keyed on `@@id([userId, permissionId])`, so
   * a duplicated id was rejected too. Any of those left the user with ZERO
   * permissions — as did two admins saving at once, or a crash in between
   * (PERM-01 / PERM-02). The people hurt were exactly the non-admins, since an
   * ADMIN bypasses permission checks and cannot lock themselves out.
   *
   * Now: validate, deduplicate, and swap inside one transaction, so the only two
   * outcomes are the new list or the old one.
   */
  async setUserPermissions(userId: string, permissionIds: string[]) {
    await this.assertUserExists(userId);

    const unique = [...new Set(permissionIds)];

    // Checked BEFORE anything is deleted. A stale id is a client-side problem (a
    // page left open while permissions were edited elsewhere) and must not cost
    // somebody their access.
    if (unique.length > 0) {
      const found = await this.prismaService.permission.findMany({
        where: { id: { in: unique } },
        select: { id: true },
      });

      if (found.length !== unique.length) {
        throw new BadRequestException(ERROR_MESSAGES.stalePermissionSelection);
      }
    }

    await this.prismaService.$transaction(async (tx) => {
      await tx.userPermission.deleteMany({ where: { userId } });

      if (unique.length > 0) {
        await tx.userPermission.createMany({
          data: unique.map((permissionId) => ({ userId, permissionId })),
        });
      }
    });

    return this.listPermissions(userId);
  }

  /**
   * All user permission names (flat array of strings).
   *
   * Deliberately no existence check: the callers are `/users/me` and the GET-user
   * route, which has already loaded the user — an extra query on every app load
   * would buy nothing.
   */
  async getUserPermissionNames(userId: string): Promise<string[]> {
    const permissions = await this.listPermissions(userId);
    return permissions.map((p) => p.name);
  }

  /**
   * The permission rows of one user. Says nothing about whether the user exists —
   * the caller decides whether that matters.
   */
  private async listPermissions(userId: string) {
    const userPermissions = await this.prismaService.userPermission.findMany({
      where: { userId },
      include: { permission: true },
    });

    return userPermissions.map((up) => up.permission);
  }

  /** 404 unless the user is real. */
  private async assertUserExists(userId: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) throw new NotFoundException(ERROR_MESSAGES.userNotFound);
  }
}
