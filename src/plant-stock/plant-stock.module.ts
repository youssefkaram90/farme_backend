import { Module } from '@nestjs/common';
import { PlantStockService } from './plant-stock.service';
import { PlantStockController } from './plant-stock.controller';

@Module({
  controllers: [PlantStockController],
  providers: [PlantStockService],
  exports: [PlantStockService],
})
export class PlantStockModule {}
