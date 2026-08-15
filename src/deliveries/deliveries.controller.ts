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

@Controller('deliveries')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DeliveriesController {
  constructor(private readonly deliveriesService: DeliveriesService) {}

  @Post()
  @RequirePermissions('deliveries.create')
  create(@Body() createDeliveryDto: CreateDeliveryDto) {
    return this.deliveriesService.create(createDeliveryDto);
  }

  @Get()
  @RequirePermissions('deliveries.view')
  findAll(@Query('q') q?: string) {
    return this.deliveriesService.findAll(q);
  }

  @Get(':id')
  @RequirePermissions('deliveries.view')
  findOne(@Param('id') id: string) {
    return this.deliveriesService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('deliveries.edit')
  update(
    @Param('id') id: string,
    @Body() updateDeliveryDto: CreateDeliveryDto,
  ) {
    return this.deliveriesService.update(id, updateDeliveryDto);
  }

  @Delete(':id')
  @RequirePermissions('deliveries.delete')
  remove(@Param('id') id: string) {
    return this.deliveriesService.remove(id);
  }
}
