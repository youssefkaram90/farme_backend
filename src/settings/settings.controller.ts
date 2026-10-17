import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../generated/prisma/client';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { AdminOnlyGuard } from '../permissions/guards/admin-only.guard';

/**
 * The figures the farm can change without a developer (SOW-11, phase 2).
 *
 * ## Reads carry no permission
 *
 * Deliberately: these are not secrets, and the clients need them to show a
 * preview while a sowing is being filled in. Anyone who may sign in may read them.
 *
 * ## Writes are ADMIN-only and carry no permission at all
 *
 * Neither a grantable `settings.*` nor anything else — the same shape as
 * `POST /stock/adjust` and the agri-input writes. These figures decide what stock
 * a sowing takes, so changing them is administration rather than a day-to-day job,
 * and `AdminOnlyGuard` can never be granted away.
 */
@Controller('settings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  /** GET /settings — every setting with its value, bounds and last change. */
  @Get()
  findAll() {
    return this.settingsService.findAll();
  }

  /** PATCH /settings/:key — store one value. ADMIN only. */
  @Patch(':key')
  @UseGuards(AdminOnlyGuard)
  update(
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
    @CurrentUser() user: User,
  ) {
    return this.settingsService.set(key, dto.value, {
      id: user.id,
      name: user.name,
    });
  }
}
