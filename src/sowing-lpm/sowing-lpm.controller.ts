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
import { SowingLPMService } from './sowing-lpm.service';
import { ExecuteLPMDto } from './dto/execute-lpm.dto';
import { UpdateLPMDto } from './dto/update-lpm.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../generated/prisma/client';

@Controller('sowing-lpm')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SowingLPMController {
  constructor(private readonly sowingLPMService: SowingLPMService) {}

  @Post('execute')
  @RequirePermissions('sowing.create')
  execute(@Body() dto: ExecuteLPMDto, @CurrentUser() user: User) {
    return this.sowingLPMService.execute(dto, user);
  }

  @Get()
  @RequirePermissions('sowing.view')
  findAll(
    @Query('q') q?: string,
    @Query('planId') planId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.sowingLPMService.findAll(q, planId, page, pageSize);
  }

  @Get(':id')
  @RequirePermissions('sowing.view')
  findOne(@Param('id') id: string) {
    return this.sowingLPMService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('sowing.edit')
  update(
    @Param('id') id: string,
    // Every field optional: PATCH does not demand the create fields (SSM-03).
    @Body() dto: UpdateLPMDto,
    @CurrentUser() user: User,
  ) {
    return this.sowingLPMService.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('sowing.delete')
  remove(@Param('id') id: string, @CurrentUser() user: User) {
    return this.sowingLPMService.remove(id, user);
  }
}
