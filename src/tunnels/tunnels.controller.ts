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
import { UpdateTunnelDto } from './dto/update-tunnel.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';

@Controller('tunnels')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TunnelsController {
  constructor(private readonly tunnelsService: TunnelsService) {}

  @Post()
  @RequirePermissions('tunnels.create')
  create(@Body() createTunnelDto: CreateTunnelDto) {
    return this.tunnelsService.create(createTunnelDto);
  }

  @Get()
  @RequirePermissions('tunnels.view')
  findAll(@Query('q') q?: string) {
    return this.tunnelsService.findAll(q);
  }

  @Get(':id')
  @RequirePermissions('tunnels.view')
  findOne(@Param('id') id: string) {
    return this.tunnelsService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('tunnels.edit')
  update(@Param('id') id: string, @Body() updateTunnelDto: UpdateTunnelDto) {
    return this.tunnelsService.update(id, updateTunnelDto);
  }

  @Delete(':id')
  @RequirePermissions('tunnels.delete')
  remove(@Param('id') id: string) {
    return this.tunnelsService.remove(id);
  }
}
