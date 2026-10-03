import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../generated/prisma/client';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { AdminOnlyGuard } from '../permissions/guards/admin-only.guard';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';
import { PermissionsService } from '../permissions/permissions.service';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';

/**
 * Class-level guards, so the safe default is "signed in, and permission-checked
 * when the route declares one" — a route cannot be added silently open
 * (USERS-05). The ADMIN-only routes add `AdminOnlyGuard` on top; class and method
 * guards both run.
 */
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly permissionsService: PermissionsService,
  ) {}

  // ADMIN only — deliberately not delegatable via the permission matrix.
  @Post()
  @UseGuards(AdminOnlyGuard)
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get()
  @RequirePermissions('users.view')
  getUsers(@Query('q') q?: string) {
    return this.usersService.getUsers(q);
  }

  @Get('me')
  async getMe(@CurrentUser() user: User) {
    // `user` comes from the JWT strategy, which now loads it WITHOUT the password
    // hash — there is nothing left to strip here (X-09).
    const permissions = await this.permissionsService.getUserPermissionNames(
      user.id,
    );

    return { ...user, permissions };
  }

  /**
   * Get detailed info about a specific user (including permissions)
   */
  @Get(':id')
  @RequirePermissions('users.view')
  async getUser(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.usersService.getUserSafe({ id });
    const permissions =
      await this.permissionsService.getUserPermissionNames(id);

    return { ...user, permissions };
  }

  /**
   * Update a user's role — ADMIN only.
   *
   * Deliberately NOT behind `users.edit`: granting that permission would let a
   * non-admin promote themselves to ADMIN (which bypasses every check).
   */
  @Patch(':id/role')
  @UseGuards(AdminOnlyGuard)
  async updateUserRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRoleDto,
  ) {
    return this.usersService.updateUserRole(id, dto.role);
  }
}
