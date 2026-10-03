import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { TrucksService } from './trucks.service';
import { CreateTruckDto, UpdateTruckDto } from './dto/truck.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';

/**
 * The fleet that carries shipments out. Lives in the shipments module because a
 * truck only exists to be picked by a shipment, but the URL stays flat
 * (`/trucks`) so the web and phone clients keep working unchanged.
 */
@Controller('trucks')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TrucksController {
  constructor(private readonly trucksService: TrucksService) {}

  @Get()
  @RequirePermissions('trucks.view')
  findAll() {
    return this.trucksService.findAll();
  }

  @Get(':id')
  @RequirePermissions('trucks.view')
  findOne(@Param('id') id: string) {
    return this.trucksService.findOne(id);
  }

  @Post()
  @RequirePermissions('trucks.create')
  create(@Body() dto: CreateTruckDto) {
    return this.trucksService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('trucks.edit')
  update(@Param('id') id: string, @Body() dto: UpdateTruckDto) {
    return this.trucksService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('trucks.delete')
  remove(@Param('id') id: string) {
    return this.trucksService.remove(id);
  }
}
