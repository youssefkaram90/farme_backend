import { Module } from '@nestjs/common';
import { ShipmentsController } from './shipments.controller';
import { ShipmentsService } from './shipments.service';
import { TrucksController } from './trucks.controller';
import { TrucksService } from './trucks.service';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Outgoing goods. Trucks live here too: a truck has no meaning on its own, it
 * only exists to be picked by a shipment.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ShipmentsController, TrucksController],
  providers: [ShipmentsService, TrucksService],
  exports: [ShipmentsService, TrucksService],
})
export class ShipmentsModule {}
