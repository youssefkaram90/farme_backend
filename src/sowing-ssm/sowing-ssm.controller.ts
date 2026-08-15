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
import { SowingSSMService } from './sowing-ssm.service';
import { ExecuteSSMDto } from './dto/execute-ssm.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('sowing-ssm')
@UseGuards(JwtAuthGuard)
export class SowingSSMController {
  constructor(private readonly sowingSSMService: SowingSSMService) {}

  @Post('execute')
  execute(@Body() dto: ExecuteSSMDto) {
    return this.sowingSSMService.execute(dto);
  }

  @Get()
  findAll(@Query('q') q?: string) {
    return this.sowingSSMService.findAll(q);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sowingSSMService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: ExecuteSSMDto) {
    return this.sowingSSMService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.sowingSSMService.remove(id);
  }
}
