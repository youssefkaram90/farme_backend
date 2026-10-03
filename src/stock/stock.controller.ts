import {
  Body,
  Controller,
  Post,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { StockService } from './stock.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';
import { AdminOnlyGuard } from '../permissions/guards/admin-only.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../generated/prisma/client';
import { AdjustStockDto } from './dto/adjust-stock.dto';

/**
 * Stock is a read-only module for everyone except the one ADMIN adjustment below
 * (decided 2026-10-01, STOCK-06).
 *
 * Quantities move as side effects of other modules — a delivery adds
 * (`deliveries`), a sowing removes (`sowing-ssm`, `sowing-lpm`), a treatment
 * consumes chemicals (`crop-care`), a harvest and a shipment move finished goods
 * (`harvest`, `shipments`) — and each of those writes its ledger row in the same
 * transaction as the quantity change, which is what keeps a lot and its history
 * in step.
 *
 * `POST /stock/adjust` covers the entries nothing else can produce: an opening
 * balance, a return to the client, waste, a correction.
 */
@Controller('stock')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Post('adjust')
  @UseGuards(AdminOnlyGuard)
  adjust(@Body() dto: AdjustStockDto, @CurrentUser() user: User) {
    return this.stockService.adjustStock(dto, user);
  }

  @Get()
  @RequirePermissions('stock.view')
  findAll(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.stockService.findAll(q, page, pageSize);
  }

  @Get('summary')
  @RequirePermissions('stock.view')
  getSummary() {
    return this.stockService.getSummary();
  }

  @Get(':id')
  @RequirePermissions('stock.view')
  findOne(@Param('id') id: string) {
    return this.stockService.findOne(id);
  }

  @Get(':id/movements')
  @RequirePermissions('stock.view')
  getMovements(@Param('id') id: string) {
    return this.stockService.getMovements(id);
  }
}
