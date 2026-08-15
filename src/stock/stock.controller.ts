import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { StockService } from './stock.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('stock')
@UseGuards(JwtAuthGuard)
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get()
  findAll(@Query('q') q?: string) {
    return this.stockService.findAll(q);
  }

  @Get('summary')
  getSummary() {
    return this.stockService.getSummary();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.stockService.findOne(id);
  }

  @Get(':id/movements')
  getMovements(@Param('id') id: string) {
    return this.stockService.getMovements(id);
  }
}
