import { Module } from '@nestjs/common';
import { SowingLPMService } from './sowing-lpm.service';
import { SowingLPMController } from './sowing-lpm.controller';
import { StockModule } from '../stock/stock.module';

@Module({
  imports: [StockModule],
  controllers: [SowingLPMController],
  providers: [SowingLPMService],
})
export class SowingLPMModule {}
