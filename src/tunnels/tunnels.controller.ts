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
import { TunnelsService } from './tunnels.service';
import { CreateTunnelDto } from './dto/create-tunnel.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('tunnels')
@UseGuards(JwtAuthGuard)
export class TunnelsController {
  constructor(private readonly tunnelsService: TunnelsService) {}

  @Post()
  create(@Body() createTunnelDto: CreateTunnelDto) {
    return this.tunnelsService.create(createTunnelDto);
  }

  @Get()
  findAll(@Query('q') q?: string) {
    return this.tunnelsService.findAll(q);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tunnelsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateTunnelDto: CreateTunnelDto) {
    return this.tunnelsService.update(id, updateTunnelDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.tunnelsService.remove(id);
  }
}
