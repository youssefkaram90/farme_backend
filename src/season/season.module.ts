import { Global, Module } from '@nestjs/common';
import { SeasonController } from './season.controller';
import { SeasonService } from './season.service';
import { SeasonCloseService } from './season-close.service';
import { PlantStockModel } from '../generated/prisma/models';
import { PlantStockModule } from '../plant-stock/plant-stock.module';

/**
 * Global, exactly like PrismaModule, so every feature module can inject
 * SeasonService without adding an import to each module file.
 */
@Global()
@Module({
  imports:[PlantStockModule],
  controllers: [SeasonController],
  providers: [SeasonService,SeasonCloseService],
  exports: [SeasonService],
})
export class SeasonModule {}