import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { SowingService } from './sowing.service';
import { CreateSowingDto } from './dto/create-sowing.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('sowing')
@UseGuards(JwtAuthGuard)
export class SowingController {
  constructor(private readonly sowingService: SowingService) {}

  @Post()
  create(@Body() createSowingDto: CreateSowingDto) {
    return this.sowingService.create(createSowingDto);
  }

  @Get()
  findAll() {
    return this.sowingService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sowingService.findOne(id);
  }
}
