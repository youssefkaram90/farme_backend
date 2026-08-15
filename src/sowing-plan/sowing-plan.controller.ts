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
import { SowingPlanService } from './sowing-plan.service';
import { CreateSowingPlanDto } from './dto/create-sowing-plan.dto';
import { CreatePlanEntryDto } from './dto/create-plan-entry.dto';
import { CreatePlanWithEntriesDto } from './dto/create-plan-with-entries.dto';
import { UpdatePlanStatusDto } from './dto/update-plan-status.dto';
import { ImportPlanExcelDto } from './dto/import-plan-excel.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('sowing-plans')
@UseGuards(JwtAuthGuard)
export class SowingPlanController {
  constructor(private readonly sowingPlanService: SowingPlanService) {}

  // --- Plans ---

  @Post()
  createPlan(@Body() dto: CreateSowingPlanDto) {
    return this.sowingPlanService.createPlan(dto);
  }

  @Post('with-entries')
  createPlanWithEntries(@Body() dto: CreatePlanWithEntriesDto) {
    return this.sowingPlanService.createPlanWithEntries(dto);
  }

  @Get('pending-entries')
  findPendingEntries() {
    return this.sowingPlanService.findPendingEntries();
  }

  @Get()
  findAllPlans(@Query('q') q?: string) {
    return this.sowingPlanService.findAllPlans(q);
  }

  @Get(':id')
  findPlanById(@Param('id') id: string) {
    return this.sowingPlanService.findPlanById(id);
  }

  @Patch(':id/status')
  updatePlanStatus(@Param('id') id: string, @Body() dto: UpdatePlanStatusDto) {
    return this.sowingPlanService.updatePlanStatus(id, dto.status);
  }

  @Delete(':id')
  deletePlan(@Param('id') id: string) {
    return this.sowingPlanService.deletePlan(id);
  }

  // --- Excel Import ---

  @Post('import')
  importFromExcel(@Body() dto: ImportPlanExcelDto) {
    return this.sowingPlanService.importFromExcel(dto);
  }

  // --- Entries ---

  @Post(':planId/entries')
  addEntry(@Param('planId') planId: string, @Body() dto: CreatePlanEntryDto) {
    return this.sowingPlanService.addEntry(planId, dto);
  }

  @Post(':planId/entries/bulk')
  addBulkEntries(
    @Param('planId') planId: string,
    @Body() dtos: CreatePlanEntryDto[],
  ) {
    return this.sowingPlanService.addBulkEntries(planId, dtos);
  }

  @Get(':planId/entries')
  findPlanEntries(@Param('planId') planId: string) {
    return this.sowingPlanService.findPlanEntries(planId);
  }

  @Patch('entries/:entryId')
  updateEntry(
    @Param('entryId') entryId: string,
    @Body() dto: CreatePlanEntryDto,
  ) {
    return this.sowingPlanService.updateEntry(entryId, dto);
  }

  @Delete('entries/:entryId')
  deleteEntry(@Param('entryId') entryId: string) {
    return this.sowingPlanService.deleteEntry(entryId);
  }
}
