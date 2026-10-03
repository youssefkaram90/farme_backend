import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { HarvestService } from './harvest.service';
import { CreateHarvestRecordDto } from './dto/harvest.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../generated/prisma/client';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';
import { AdminOnlyGuard } from '../permissions/guards/admin-only.guard';
import { WriteOffHarvestDto } from './dto/writeoff-harvest.dto';

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class HarvestController {
  constructor(private readonly harvestService: HarvestService) {}

  @Post('harvest-records')
  @RequirePermissions('harvest.create')
  createRecord(@Body() dto: CreateHarvestRecordDto, @CurrentUser() user: User) {
    return this.harvestService.createRecord(dto, user);
  }

  @Get('harvest-records')
  @RequirePermissions('harvest.view')
  findAllRecords(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
  ) {
    return this.harvestService.findAllRecords(
      q,
      page,
      pageSize,
      targetType,
      targetId,
    );
  }

  @Get('harvest-records/summary')
  @RequirePermissions('harvest.view')
  findSummary() {
    return this.harvestService.findSummary();
  }

  @Get('harvest-records/:id')
  @RequirePermissions('harvest.view')
  findOneRecord(@Param('id') id: string) {
    return this.harvestService.findOneRecord(id);
  }

  @Delete('harvest-records/:id')
  @RequirePermissions('harvest.delete')
  deleteRecord(@Param('id') id: string, @CurrentUser() user: User) {
    return this.harvestService.deleteRecord(id, user);
  }

  @Get('harvested-products')
  @RequirePermissions('harvest.view')
  findAllProducts() {
    return this.harvestService.findAllProducts();
  }

  /**
   * Write off what is left of a product — the boxes that spoiled, were thrown
   * away, or were counted wrong. Not a normal user action: it moves stock out
   * with no sale behind it, so it is ADMIN-only and never a grantable
   * permission (an administrator must be able to say who emptied the shelf).
   */
  @Post('harvested-products/:id/writeoff')
  @UseGuards(AdminOnlyGuard)
  writeOffProduct(
    @Param('id') id: string,
    @Body() dto: WriteOffHarvestDto,
    @CurrentUser() user: User,
  ) {
    return this.harvestService.writeOffProduct(id, dto, user);
  }
}
