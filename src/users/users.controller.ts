import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../generated/prisma/client';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';
import { PermissionsService } from '../permissions/permissions.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly permissionsService: PermissionsService,
  ) {}

  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('users.view')
  getUsers() {
    return this.usersService.getUsers();
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@CurrentUser() user: User) {
    const { password, ...result } = user;
    // Include permissions in the response
    const permissions = await this.permissionsService.getUserPermissionNames(
      user.id,
    );
    return { ...result, permissions };
  }

  /**
   * Get detailed info about a specific user (including permissions)
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('users.view')
  async getUser(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.usersService.getUser({ id });
    const { password, ...result } = user;
    const permissions =
      await this.permissionsService.getUserPermissionNames(id);
    return { ...result, permissions };
  }

  /**
   * Update a user's role
   */
  @Patch(':id/role')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('users.edit')
  async updateUserRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('role') role: string,
  ) {
    return this.usersService.updateUser({ id }, { role });
  }
}
