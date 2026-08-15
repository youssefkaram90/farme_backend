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
import { SowingLPMService } from './sowing-lpm.service';
import { ExecuteLPMDto } from './dto/execute-lpm.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('sowing-lpm')
@UseGuards(JwtAuthGuard)
export class SowingLPMController {
  constructor(private readonly sowingLPMService: SowingLPMService) {}

  @Post('execute')
  execute(@Body() dto: ExecuteLPMDto) {
    return this.sowingLPMService.execute(dto);
  }

  @Get()
  findAll(@Query('q') q?: string, @Query('planId') planId?: string) {
    return this.sowingLPMService.findAll(q, planId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sowingLPMService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: ExecuteLPMDto) {
    return this.sowingLPMService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.sowingLPMService.remove(id);
  }
}
