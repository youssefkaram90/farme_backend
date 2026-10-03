import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TrayTransportService } from './tray-transport.service';
import {
  CreateTunnelAssignmentsDto,
  UpdateTunnelAssignmentDto,
} from './dto/tunnel-assignment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { UserRole } from '../users/enums/userRole.enum';
import type { User } from '../generated/prisma/client';

/**
 * Moving trays out of the nursery and into tunnels — the last step of a sowing.
 *
 * ## Permissions
 *
 * These routes ride `sowing.*`, like `sowing-plan`, `sowing-ssm` and `sowing-lpm`
 * (decided 2026-10-02, TRAY-05). They used to carry their own `tray-transport.*`
 * set, which meant an operator who could sow could not move what they had sown,
 * and the admin had a fifth set of boxes to tick for something the screens
 * present as one workflow.
 *
 * **Consequence for existing grants:** the seed drops permissions it no longer
 * declares, so anybody whose only grant was `tray-transport.*` must be given
 * `sowing.create` / `sowing.edit` / `sowing.delete` instead.
 *
 * ## Notes
 *
 * These routes previously had no guard at all — they were fully public.
 */
@Controller('tray-transport')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TrayTransportController {
  constructor(private readonly service: TrayTransportService) {}

  /**
   * The role is passed down because the season rule here cannot be applied by an
   * interceptor: the ids travel in the body, so this route is judged in the
   * service (TRAY-03).
   */
  @Post()
  @RequirePermissions('sowing.create')
  assign(@Body() dto: CreateTunnelAssignmentsDto, @CurrentUser() user: User) {
    return this.service.assign(dto, user.role === UserRole.ADMIN);
  }

  @Get('pending')
  @RequirePermissions('sowing.view')
  findPendingTransport() {
    return this.service.findPendingTransport();
  }

  @Get()
  @RequirePermissions('sowing.view')
  findAll(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.service.findAll(page, pageSize);
  }

  @Get('sowing/:ssmSowingId')
  @RequirePermissions('sowing.view')
  findBySowing(@Param('ssmSowingId') ssmSowingId: string) {
    return this.service.findBySowing(ssmSowingId);
  }

  @Get('tunnel/:tunnelId')
  @RequirePermissions('sowing.view')
  findByTunnel(@Param('tunnelId') tunnelId: string) {
    return this.service.findByTunnel(tunnelId);
  }

  @Patch(':id')
  @RequirePermissions('sowing.edit')
  update(@Param('id') id: string, @Body() dto: UpdateTunnelAssignmentDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('sowing.delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
