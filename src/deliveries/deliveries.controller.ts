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
import { DeliveriesService } from './deliveries.service';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../generated/prisma/client';

@Controller('deliveries')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DeliveriesController {
  constructor(private readonly deliveriesService: DeliveriesService) {}

  @Post()
  @RequirePermissions('deliveries.create')
  create(
    @Body() createDeliveryDto: CreateDeliveryDto,
    @CurrentUser() user: User,
  ) {
    return this.deliveriesService.create(createDeliveryDto, user);
  }

  @Get()
  @RequirePermissions('deliveries.view')
  findAll(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.deliveriesService.findAll(q, page, pageSize);
  }

  @Get(':id')
  @RequirePermissions('deliveries.view')
  findOne(@Param('id') id: string) {
    return this.deliveriesService.findOne(id);
  }

  /**
   * Replace a delivery — the WHOLE delivery, not one changed field.
   *
   * The body is the create shape on purpose: the service reverses the old lots'
   * stock and applies the new ones in one transaction, so a request that named
   * only part of the delivery would leave the rest undefined and the ledger
   * guessing (DEL-4). Both clients send the whole form on an edit.
   */
  @Patch(':id')
  @RequirePermissions('deliveries.edit')
  update(
    @Param('id') id: string,
    @Body() dto: CreateDeliveryDto,
    @CurrentUser() user: User,
  ) {
    return this.deliveriesService.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('deliveries.delete')
  remove(@Param('id') id: string, @CurrentUser() user: User) {
    return this.deliveriesService.remove(id, user);
  }
}
