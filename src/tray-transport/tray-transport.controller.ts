import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { TrayTransportService } from './tray-transport.service';
import {
  CreateTunnelAssignmentsDto,
  UpdateTunnelAssignmentDto,
} from './dto/tunnel-assignment.dto';

@Controller('tray-transport')
export class TrayTransportController {
  constructor(private readonly service: TrayTransportService) {}

  @Post()
  assign(@Body() dto: CreateTunnelAssignmentsDto) {
    return this.service.assign(dto);
  }

  @Get('pending')
  findPendingTransport() {
    return this.service.findPendingTransport();
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get('sowing/:ssmSowingId')
  findBySowing(@Param('ssmSowingId') ssmSowingId: string) {
    return this.service.findBySowing(ssmSowingId);
  }

  @Get('tunnel/:tunnelId')
  findByTunnel(@Param('tunnelId') tunnelId: string) {
    return this.service.findByTunnel(tunnelId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTunnelAssignmentDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
