import { Module } from '@nestjs/common';
import { SowingPlanService } from './sowing-plan.service';
import { SowingPlanController } from './sowing-plan.controller';

@Module({
  controllers: [SowingPlanController],
  providers: [SowingPlanService],
  exports: [SowingPlanService],
})
export class SowingPlanModule {}
