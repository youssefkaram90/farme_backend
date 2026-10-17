import { Module } from '@nestjs/common';
import { SowingPlanService } from './sowing-plan.service';
import { SowingPlanController } from './sowing-plan.controller';
import { SettingsModule } from '../settings/settings.module';

/**
 * SettingsModule because a field plan reads the density it is planned at, so the
 * farm can change that figure without a developer (SOW-11).
 */
@Module({
  imports: [SettingsModule],
  controllers: [SowingPlanController],
  providers: [SowingPlanService],
  exports: [SowingPlanService],
})
export class SowingPlanModule {}
