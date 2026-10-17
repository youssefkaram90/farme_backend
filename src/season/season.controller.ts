import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminOnlyGuard } from '../permissions/guards/admin-only.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { UserRole } from '../users/enums/userRole.enum';
import { SeasonService } from './season.service';
import { SeasonCloseService } from './season-close.service';
import { CreateSeasonDto } from './dto/create-season.dto';
import { CloseSeasonDto } from './dto/close-season.dto';
import type { User } from '../generated/prisma/client';

// NOTE: 'active' is declared FIRST on purpose. Nest matches routes in
// declaration order, so a ':id'-shaped route declared above it would otherwise
// swallow it.
@Controller('seasons')
export class SeasonController {
  constructor(
    private readonly seasonService: SeasonService,
    private seasonCloseService: SeasonCloseService,
  ) {}

  /**
   * The open season — any signed-in user, because every screen shows it.
   *
   * `viewing` names the season an administrator is browsing instead of the open
   * one; `null` for everybody else. Additive on purpose, so both clients keep
   * parsing this exactly as they already do (SEASON-06).
   */
  @Get('active')
  @UseGuards(JwtAuthGuard)
  async findActive() {
    const open = this.seasonService.getActive();
    if (!open) return null;

    return { ...open, viewing: await this.seasonService.getViewing() };
  }

  /**
   * Does the open season match today's date?
   *
   * Any signed-in user: the answer is one sentence each client shows, worded for
   * the caller — administrators get the actionable version, everybody else the
   * neutral one (decided 2026-09-30). Deliberately NOT merged into `active`, so
   * that endpoint's shape stays as both clients already expect it.
   */
  @Get('alignment')
  @UseGuards(JwtAuthGuard)
  alignment(@CurrentUser() user: User) {
    return this.seasonService.getAlignment(
      user?.role === UserRole.ADMIN.toString(),
    );
  }

  /**
   * What closing this season would do: what blocks it, what it warns about, and
   * what the season ends with. ADMIN-only: a closed season is the administrator's
   * business, and managing a season can never be granted as a permission.
   */
  @Get(':id/close-preview')
  @UseGuards(JwtAuthGuard, AdminOnlyGuard)
  closePreview(@Param('id') id: string) {
    return this.seasonCloseService.buildPreview(id);
  }

  /**
   * Close this season, then open whichever season the administrator chose — or
   * none (`open: null`). ADMIN-only: closing is never a grantable permission.
   */
  @Post(':id/close')
  @UseGuards(JwtAuthGuard, AdminOnlyGuard)
  close(
    @Param('id') id: string,
    @Body() dto: CloseSeasonDto,
    @CurrentUser() user: User,
  ) {
    return this.seasonCloseService.close(id, dto.open ?? null, user);
  }

  // Everything below is ADMIN-only: a closed season is restricted to
  // administrators, and managing a season is never a grantable permission.
  @Get()
  @UseGuards(JwtAuthGuard, AdminOnlyGuard)
  findAll() {
    return this.seasonService.findAll();
  }

  @Post()
  @UseGuards(JwtAuthGuard, AdminOnlyGuard)
  create(@Body() dto: CreateSeasonDto, @CurrentUser() user: User) {
    return this.seasonService.create(dto.code, user);
  }

  @Patch(':id/activate')
  @UseGuards(JwtAuthGuard, AdminOnlyGuard)
  activate(@Param('id') id: string) {
    return this.seasonService.activate(id);
  }
}
