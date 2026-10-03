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
import { CropCareService } from './crop-care.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../generated/prisma/client';
import {
  CreatePhytosanitaryProductDto,
  UpdatePhytosanitaryProductDto,
  CreatePhytosanitaryProgramDto,
  UpdatePhytosanitaryProgramDto,
  CreateCropOperationDto,
  CreateCropCarePlanDto,
  CreatePlanEntryDto,
  UpdatePlanStatusDto,
  ExecutePlanEntryDto,
} from './dto/crop-care.dto';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';
import { UserRole } from '../users/enums/userRole.enum';

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CropCareController {
  constructor(private readonly cropCareService: CropCareService) {}

  // ============================================================
  // Phytosanitary products
  // ============================================================

  @Get('phytosanitary-products')
  @RequirePermissions('phytosanitary.view')
  findAllProducts(@Query('q') q?: string) {
    return this.cropCareService.findAllProducts(q);
  }

  @Post('phytosanitary-products')
  @RequirePermissions('phytosanitary.create')
  createProduct(@Body() dto: CreatePhytosanitaryProductDto) {
    return this.cropCareService.createProduct(dto);
  }

  @Get('phytosanitary-products/:id')
  @RequirePermissions('phytosanitary.view')
  findOneProduct(@Param('id') id: string) {
    return this.cropCareService.findOneProduct(id);
  }

  @Patch('phytosanitary-products/:id')
  @RequirePermissions('phytosanitary.edit')
  updateProduct(
    @Param('id') id: string,
    @Body() dto: UpdatePhytosanitaryProductDto,
  ) {
    return this.cropCareService.updateProduct(id, dto);
  }

  @Delete('phytosanitary-products/:id')
  @RequirePermissions('phytosanitary.delete')
  deleteProduct(@Param('id') id: string) {
    return this.cropCareService.deleteProduct(id);
  }

  // ============================================================
  // Phytosanitary program + compliance
  // ============================================================

  @Get('phytosanitary-program')
  @RequirePermissions('phytosanitary.view')
  getProgram() {
    return this.cropCareService.getProgram();
  }

  @Post('phytosanitary-program')
  @RequirePermissions('phytosanitary.create')
  createProgram(@Body() dto: CreatePhytosanitaryProgramDto) {
    return this.cropCareService.createProgram(dto);
  }

  @Patch('phytosanitary-program/:id')
  @RequirePermissions('phytosanitary.edit')
  updateProgram(
    @Param('id') id: string,
    @Body() dto: UpdatePhytosanitaryProgramDto,
  ) {
    return this.cropCareService.updateProgram(id, dto);
  }

  @Get('phytosanitary-compliance')
  @RequirePermissions('phytosanitary.view')
  getCompliance() {
    return this.cropCareService.getCompliance();
  }

  // ============================================================
  // Crop operations (standalone log)
  // ============================================================

  @Post('crop-operations')
  @RequirePermissions('crop-care.create')
  createOperation(
    @Body() dto: CreateCropOperationDto,
    @CurrentUser() user: User,
  ) {
    return this.cropCareService.createOperation(dto, user);
  }

  @Get('crop-operations')
  @RequirePermissions('crop-care.view')
  findAllOperations(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('operationType') operationType?: string,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
  ) {
    return this.cropCareService.findAllOperations(
      q,
      page,
      pageSize,
      operationType,
      targetType,
      targetId,
    );
  }

  @Get('crop-operations/:id')
  @RequirePermissions('crop-care.view')
  findOneOperation(@Param('id') id: string) {
    return this.cropCareService.findOneOperation(id);
  }

  @Delete('crop-operations/:id')
  @RequirePermissions('crop-care.delete')
  deleteOperation(@Param('id') id: string, @CurrentUser() user: User) {
    return this.cropCareService.deleteOperation(id, user);
  }

  // ============================================================
  // Crop care plans
  // ============================================================

  @Post('crop-care-plans')
  @RequirePermissions('crop-care.create')
  createPlan(@Body() dto: CreateCropCarePlanDto) {
    return this.cropCareService.createPlan(dto);
  }

  @Get('crop-care-plans/pending-entries')
  @RequirePermissions('crop-care.view')
  findPendingEntries() {
    return this.cropCareService.findPendingEntries();
  }

  @Get('crop-care-plans')
  @RequirePermissions('crop-care.view')
  findAllPlans(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.cropCareService.findAllPlans(q, page, pageSize);
  }

  @Get('crop-care-plans/:id')
  @RequirePermissions('crop-care.view')
  findPlanById(@Param('id') id: string) {
    return this.cropCareService.findPlanById(id);
  }

  @Patch('crop-care-plans/:id/status')
  @RequirePermissions('crop-care.edit')
  updatePlanStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePlanStatusDto,
    @CurrentUser() user: User,
  ) {
    return this.cropCareService.updatePlanStatus(
      id,
      dto.status,
      user.role === UserRole.ADMIN,
    );
  }

  @Delete('crop-care-plans/:id')
  @RequirePermissions('crop-care.delete')
  deletePlan(@Param('id') id: string) {
    return this.cropCareService.deletePlan(id);
  }

  @Post('crop-care-plans/:id/entries')
  @RequirePermissions('crop-care.create')
  addPlanEntry(@Param('id') planId: string, @Body() dto: CreatePlanEntryDto) {
    return this.cropCareService.addPlanEntry(planId, dto);
  }

  @Delete('crop-care-plans/entries/:entryId')
  @RequirePermissions('crop-care.delete')
  deletePlanEntry(@Param('entryId') entryId: string) {
    return this.cropCareService.deletePlanEntry(entryId);
  }

  @Post('crop-care-plans/entries/:entryId/execute')
  @RequirePermissions('crop-care.create')
  executePlanEntry(
    @Param('entryId') entryId: string,
    @Body() dto: ExecutePlanEntryDto,
    @CurrentUser() user: User,
  ) {
    return this.cropCareService.executePlanEntry(entryId, dto, user);
  }
}
