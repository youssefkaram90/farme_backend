import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
   * Get the permissions assigned to a specific user
   */
  async getUserPermissions(userId: string) {
    const userPermissions = await this.prismaService.userPermission.findMany({
      where: { userId },
      include: { permission: true },
    });
    return userPermissions.map((up) => up.permission);
  }

  /**
   * Get user IDs that have a specific permission
   */
  async getUsersWithPermission(permissionName: string) {
    const users = await this.prismaService.userPermission.findMany({
      where: { permission: { name: permissionName } },
      include: { user: true },
    });
    return users.map((up) => up.user);
  }

  /**
   * Set permissions for a user (replaces all existing permissions)
   */
  async setUserPermissions(userId: string, permissionIds: string[]) {
    // Verify user exists
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new NotFoundException('User not found');

    // Delete existing permissions
    await this.prismaService.userPermission.deleteMany({
      where: { userId },
    });

    // Assign new permissions
    if (permissionIds.length > 0) {
      await this.prismaService.userPermission.createMany({
        data: permissionIds.map((permissionId) => ({
          userId,
          permissionId,
        })),
      });
    }

    return this.getUserPermissions(userId);
  }

  /**
   * Check if a user has a specific permission
   */
  async userHasPermission(userId: string, permissionName: string) {
    const count = await this.prismaService.userPermission.count({
      where: {
        userId,
        permission: { name: permissionName },
      },
    });
    return count > 0;
  }

  /**
   * Check if a user has any of the given permissions
   */
  async userHasAnyPermission(userId: string, permissionNames: string[]) {
    const count = await this.prismaService.userPermission.count({
      where: {
        userId,
        permission: { name: { in: permissionNames } },
      },
    });
    return count > 0;
  }

  /**
   * Get all user permission names (flat array of strings)
   */
  async getUserPermissionNames(userId: string): Promise<string[]> {
    const permissions = await this.getUserPermissions(userId);
    return permissions.map((p) => p.name);
  }
}
