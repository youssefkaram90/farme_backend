import { Module } from '@nestjs/common';
import { SowingService } from './sowing.service';
import { SowingController } from './sowing.controller';
import { StockModule } from '../stock/stock.module';

@Module({
  imports: [StockModule],
  controllers: [SowingController],
  providers: [SowingService],
})
export class SowingModule {}
