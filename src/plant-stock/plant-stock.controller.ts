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

@Controller('plant-stock')
@UseGuards(JwtAuthGuard)
export class PlantStockController {
  constructor(private readonly plantStockService: PlantStockService) {}

  @Get()
  findAll(@Query('q') q?: string, @Query('stage') stage?: string) {
    return this.plantStockService.findAll(q, stage);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.plantStockService.findOne(id);
  }

  @Post(':id/counts')
  createCount(@Param('id') id: string, @Body() dto: CreatePlantCountDto) {
    return this.plantStockService.createCount(id, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePlantStockDto) {
    return this.plantStockService.update(id, dto);
  }
}
