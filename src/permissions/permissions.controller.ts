import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PermissionsGuard } from './guards/permissions.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';

@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  /**
   * Get all available permissions in the system
   */
  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('permissions.view')
  getAllPermissions() {
    return this.permissionsService.getAllPermissions();
  }

  /**
   * Get permissions for a specific user
   */
  @Get('users/:userId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('permissions.view')
  getUserPermissions(@Param('userId') userId: string) {
    return this.permissionsService.getUserPermissions(userId);
  }

  /**
   * Set permissions for a user (ADMIN only - checked in guard)
   */
  @Post('users/:userId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('permissions.manage')
  setUserPermissions(
    @Param('userId') userId: string,
    @Body('permissionIds') permissionIds: string[],
  ) {
    return this.permissionsService.setUserPermissions(userId, permissionIds);
  }
}
