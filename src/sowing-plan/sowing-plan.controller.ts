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
  ParseArrayPipe,
} from '@nestjs/common';
import { SowingPlanService } from './sowing-plan.service';
import { CreateSowingPlanDto } from './dto/create-sowing-plan.dto';
import { CreatePlanEntryDto } from './dto/create-plan-entry.dto';
import { CreatePlanWithEntriesDto } from './dto/create-plan-with-entries.dto';
import { UpdatePlanStatusDto } from './dto/update-plan-status.dto';
import { ImportPlanExcelDto } from './dto/import-plan-excel.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { UserRole } from '../users/enums/userRole.enum';
import type { User } from '../generated/prisma/client';

@Controller('sowing-plans')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SowingPlanController {
  constructor(private readonly sowingPlanService: SowingPlanService) {}

  // --- Plans ---

  @Post()
  @RequirePermissions('sowing.create')
  createPlan(@Body() dto: CreateSowingPlanDto) {
    return this.sowingPlanService.createPlan(dto);
  }

  @Post('with-entries')
  @RequirePermissions('sowing.create')
  createPlanWithEntries(@Body() dto: CreatePlanWithEntriesDto) {
    return this.sowingPlanService.createPlanWithEntries(dto);
  }

  @Get('pending-entries')
  @RequirePermissions('sowing.view')
  findPendingEntries(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.sowingPlanService.findPendingEntries(page, pageSize);
  }

  @Get()
  @RequirePermissions('sowing.view')
  findAllPlans(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.sowingPlanService.findAllPlans(q, page, pageSize);
  }

  @Get(':id')
  @RequirePermissions('sowing.view')
  findPlanById(@Param('id') id: string) {
    return this.sowingPlanService.findPlanById(id);
  }

  @Patch(':id/status')
  @RequirePermissions('sowing.edit')
  updatePlanStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePlanStatusDto,
    @CurrentUser() user: User,
  ) {
    return this.sowingPlanService.updatePlanStatus(
      id,
      dto.status,
      user.role === UserRole.ADMIN,
    );
  }

  @Delete(':id')
  @RequirePermissions('sowing.delete')
  deletePlan(@Param('id') id: string) {
    return this.sowingPlanService.deletePlan(id);
  }

  // --- Excel Import ---

  @Post('import')
  @RequirePermissions('sowing.create')
  importFromExcel(@Body() dto: ImportPlanExcelDto) {
    return this.sowingPlanService.importFromExcel(dto);
  }

  // --- Entries ---

  @Post(':planId/entries')
  @RequirePermissions('sowing.create')
  addEntry(@Param('planId') planId: string, @Body() dto: CreatePlanEntryDto) {
    return this.sowingPlanService.addEntry(planId, dto);
  }

  @Post(':planId/entries/bulk')
  @RequirePermissions('sowing.create')
  addBulkEntries(
    @Param('planId') planId: string,
    // Element-by-element validation, which an array body does not get by
    // default: without this the whitelist, `NormalizeName`, `@Min` and
    // `@IsUUID` never ran on a single element (SPLAN-05). _Note: no client calls
    // this route today — both `addBulkPlanEntries` helpers exist and neither is
    // used — so tightening it cannot break a screen._
    @Body(
      new ParseArrayPipe({
        items: CreatePlanEntryDto,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    dtos: CreatePlanEntryDto[],
  ) {
    return this.sowingPlanService.addBulkEntries(planId, dtos);
  }

  @Get(':planId/entries')
  @RequirePermissions('sowing.view')
  findPlanEntries(@Param('planId') planId: string) {
    return this.sowingPlanService.findPlanEntries(planId);
  }

  @Patch('entries/:entryId')
  @RequirePermissions('sowing.edit')
  updateEntry(
    @Param('entryId') entryId: string,
    @Body() dto: CreatePlanEntryDto,
  ) {
    return this.sowingPlanService.updateEntry(entryId, dto);
  }

  @Patch('entries/:entryId/close')
  @RequirePermissions('sowing.edit')
  closeEntry(@Param('entryId') entryId: string) {
    return this.sowingPlanService.closeEntry(entryId);
  }

  /**
   * Undo a manual close (SPLAN-02). The entry goes back to whatever its sowings
   * say it is — EXECUTED, PARTIALLY_EXECUTED or PLANNED.
   */
  @Patch('entries/:entryId/reopen')
  @RequirePermissions('sowing.edit')
  reopenEntry(@Param('entryId') entryId: string) {
    return this.sowingPlanService.reopenEntry(entryId);
  }

  @Delete('entries/:entryId')
  @RequirePermissions('sowing.delete')
  deleteEntry(@Param('entryId') entryId: string) {
    return this.sowingPlanService.deleteEntry(entryId);
  }
}
