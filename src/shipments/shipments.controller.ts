import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ShipmentsService } from './shipments.service';
import { CreateShipmentDto } from './dto/shipment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../generated/prisma/client';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';

/**
 * Shipments ride the TRUCK permissions (decided 2026-10-13), the way tray
 * transport rides `sowing.*` (TRAY-05).
 *
 * A shipment is only ever reached through the truck that carried it, so a set of
 * permissions of its own could not hide anything: whoever could see the truck
 * saw the loads with it, and nobody was gated on `shipments.view` alone. One
 * module, one set — see the note in `prisma/seed.ts`.
 *
 * The URLs are deliberately unchanged: `/shipments`, flat, as they have always
 * been.
 */
@Controller('shipments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ShipmentsController {
  constructor(private readonly shipmentsService: ShipmentsService) {}

  @Post()
  @RequirePermissions('trucks.create')
  create(@Body() dto: CreateShipmentDto, @CurrentUser() user: User) {
    return this.shipmentsService.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('trucks.edit')
  update(
    @Param('id') id: string,
    @Body() dto: CreateShipmentDto,
    @CurrentUser() user: User,
  ) {
    return this.shipmentsService.update(id, dto, user);
  }

  @Get()
  @RequirePermissions('trucks.view')
  findAll(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.shipmentsService.findAll(q, page, pageSize);
  }

  @Get(':id')
  @RequirePermissions('trucks.view')
  findOne(@Param('id') id: string) {
    return this.shipmentsService.findOne(id);
  }

  @Delete(':id')
  @RequirePermissions('trucks.delete')
  remove(@Param('id') id: string, @CurrentUser() user: User) {
    return this.shipmentsService.remove(id, user);
  }
}
