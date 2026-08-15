import { Module } from '@nestjs/common';
import { SowingSSMService } from './sowing-ssm.service';
import { SowingSSMController } from './sowing-ssm.controller';
import { StockModule } from '../stock/stock.module';

@Module({
  imports: [StockModule],
  controllers: [SowingSSMController],
  providers: [SowingSSMService],
})
export class SowingSSMModule {}
