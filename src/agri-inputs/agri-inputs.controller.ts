import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AgriInputsService } from './agri-inputs.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../generated/prisma/client';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';
import { AdminOnlyGuard } from '../permissions/guards/admin-only.guard';
import { AddAgriInputDto, AdjustAgriInputDto } from './dto/agri-inputs.dto';

/**
 * Agri-inputs: which products a season may use, and how much of each is left.
 *
 * **Reads** reuse the existing `phytosanitary.view` permission — no new
 * permission was invented; anyone allowed to see the product catalogue may
 * also see which of those products this season is allowed to use.
 *
 * **Writes are ADMIN-only and carry no permission at all** — neither a grantable
 * `agri-inputs.*` nor `phytosanitary.*` — the same
 * shape as `POST /stock/adjust`. Deciding what is allowed in a season, and
 * correcting a quantity, is season administration rather than a day-to-day job.
 */
@Controller('agri-inputs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AgriInputsController {
  constructor(private readonly agriInputsService: AgriInputsService) {}

  @Get()
  @RequirePermissions('phytosanitary.view')
  findAll(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.agriInputsService.findAll(q, page, pageSize);
  }

  @Get(':id')
  @RequirePermissions('phytosanitary.view')
  findOne(@Param('id') id: string) {
    return this.agriInputsService.findOne(id);
  }

  @Get(':id/movements')
  @RequirePermissions('phytosanitary.view')
  findMovements(@Param('id') id: string) {
    return this.agriInputsService.findMovements(id);
  }

  @Post()
  @UseGuards(AdminOnlyGuard)
  addProduct(@Body() dto: AddAgriInputDto, @CurrentUser() user: User) {
    return this.agriInputsService.addProduct(dto, user);
  }

  @Post(':id/adjust')
  @UseGuards(AdminOnlyGuard)
  adjust(
    @Param('id') id: string,
    @Body() dto: AdjustAgriInputDto,
    @CurrentUser() user: User,
  ) {
    return this.agriInputsService.adjustStock(id, dto, user);
  }

  @Delete(':id')
  @UseGuards(AdminOnlyGuard)
  removeProduct(@Param('id') id: string) {
    return this.agriInputsService.removeProduct(id);
  }
}
