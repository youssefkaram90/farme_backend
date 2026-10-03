import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { AdminOnlyGuard } from './guards/admin-only.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import { SetUserPermissionsDto } from './dto/set-user-permissions.dto';

/**
 * Class-level guards for the same reason as `UsersController`: the default has to
 * be "signed in", not "whatever the last route remembered to add" (USERS-05).
 * The ADMIN-only route adds `AdminOnlyGuard` on top.
 */
@Controller('permissions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  /**
   * Get all available permissions in the system
   */
  @Get()
  @RequirePermissions('permissions.view')
  getAllPermissions() {
    return this.permissionsService.getAllPermissions();
  }

  /**
   * Get permissions for a specific user
   */
  @Get('users/:userId')
  @RequirePermissions('permissions.view')
  getUserPermissions(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.permissionsService.getUserPermissions(userId);
  }

  /**
   * Set permissions for a user — ADMIN only.
   *
   * Deliberately NOT behind the `permissions.manage` permission: granting
   * permissions is equivalent to granting anything, so a non-admin holding it
   * could escalate themselves. Reserved for administrators.
   */
  @Post('users/:userId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminOnlyGuard)
  setUserPermissions(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetUserPermissionsDto,
  ) {
    return this.permissionsService.setUserPermissions(
      userId,
      dto.permissionIds,
    );
  }
}
