import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SowingSSMService } from './sowing-ssm.service';
import { ExecuteSSMDto } from './dto/execute-ssm.dto';
import { UpdateSSMDto } from './dto/update-ssm.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../generated/prisma/client';

@Controller('sowing-ssm')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SowingSSMController {
  constructor(private readonly sowingSSMService: SowingSSMService) {}

  @Post('execute')
  @RequirePermissions('sowing.create')
  execute(@Body() dto: ExecuteSSMDto, @CurrentUser() user: User) {
    return this.sowingSSMService.execute(dto, user);
  }

  @Get()
  @RequirePermissions('sowing.view')
  findAll(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.sowingSSMService.findAll(q, page, pageSize);
  }

  @Get(':id')
  @RequirePermissions('sowing.view')
  findOne(@Param('id') id: string) {
    return this.sowingSSMService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('sowing.edit')
  update(
    @Param('id') id: string,
    // The create dto is not the edit dto: PATCH takes every field as optional
    // (SSM-03).
    @Body() dto: UpdateSSMDto,
    @CurrentUser() user: User,
  ) {
    return this.sowingSSMService.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('sowing.delete')
  remove(@Param('id') id: string, @CurrentUser() user: User) {
    return this.sowingSSMService.remove(id, user);
  }
}
