import { Module } from '@nestjs/common';
import { SowingSSMService } from './sowing-ssm.service';
import { SowingSSMController } from './sowing-ssm.controller';
import { StockModule } from '../stock/stock.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [StockModule, SettingsModule],
  controllers: [SowingSSMController],
  providers: [SowingSSMService],
})
export class SowingSSMModule {}
