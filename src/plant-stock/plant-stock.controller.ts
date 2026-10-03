import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PlantStockService } from './plant-stock.service';
import { UpdatePlantStockDto } from './dto/update-plant-stock.dto';
import { CreatePlantCountDto } from './dto/create-plant-count.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { UserRole } from '../users/enums/userRole.enum';
import type { User } from '../generated/prisma/client';

@Controller('plant-stock')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PlantStockController {
  constructor(private readonly plantStockService: PlantStockService) {}

  @Get()
  @RequirePermissions('plant-stock.view')
  findAll(
    @Query('q') q?: string,
    @Query('stage') stage?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.plantStockService.findAll(q, stage, page, pageSize);
  }

  /**
   * One batch, as a detail screen would show it — the row the list builds for a
   * batch taken as a whole.
   *
   * **Nothing calls it yet** (kept by decision 2026-10-01, PSTOCK-07). Both
   * clients build only `/plant-stock` and `/plant-stock/:id/counts`, and the web
   * has no proxy route for this one, so it is unused — but kept on purpose as
   * the batch-detail endpoint, not left behind by accident.
   */
  @Get(':id')
  @RequirePermissions('plant-stock.view')
  findOne(@Param('id') id: string) {
    return this.plantStockService.findOne(id);
  }

  @Post(':id/counts')
  @RequirePermissions('plant-stock.create')
  createCount(
    @Param('id') id: string,
    @Body() dto: CreatePlantCountDto,
    @CurrentUser() user: User,
  ) {
    return this.plantStockService.createCount(
      id,
      dto,
      user.role === UserRole.ADMIN,
    );
  }

  @Patch(':id')
  @RequirePermissions('plant-stock.edit')
  update(@Param('id') id: string, @Body() dto: UpdatePlantStockDto) {
    return this.plantStockService.update(id, dto);
  }
}
