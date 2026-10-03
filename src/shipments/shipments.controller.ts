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

@Controller('shipments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ShipmentsController {
  constructor(private readonly shipmentsService: ShipmentsService) {}

  @Post()
  @RequirePermissions('shipments.create')
  create(@Body() dto: CreateShipmentDto, @CurrentUser() user: User) {
    return this.shipmentsService.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('shipments.edit')
  update(
    @Param('id') id: string,
    @Body() dto: CreateShipmentDto,
    @CurrentUser() user: User,
  ) {
    return this.shipmentsService.update(id, dto, user);
  }

  @Get()
  @RequirePermissions('shipments.view')
  findAll(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.shipmentsService.findAll(q, page, pageSize);
  }

  @Get(':id')
  @RequirePermissions('shipments.view')
  findOne(@Param('id') id: string) {
    return this.shipmentsService.findOne(id);
  }

  @Delete(':id')
  @RequirePermissions('shipments.delete')
  remove(@Param('id') id: string, @CurrentUser() user: User) {
    return this.shipmentsService.remove(id, user);
  }
}
