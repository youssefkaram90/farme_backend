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
import { SectorsService } from './sectors.service';
import { CreateSectorDto } from './dto/create-sector.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('sectors')
@UseGuards(JwtAuthGuard)
export class SectorsController {
  constructor(private readonly sectorsService: SectorsService) {}

  @Post()
  create(@Body() createSectorDto: CreateSectorDto) {
    return this.sectorsService.create(createSectorDto);
  }

  @Get()
  findAll(@Query('q') q?: string) {
    return this.sectorsService.findAll(q);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sectorsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateSectorDto: CreateSectorDto) {
    return this.sectorsService.update(id, updateSectorDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.sectorsService.remove(id);
  }
}
