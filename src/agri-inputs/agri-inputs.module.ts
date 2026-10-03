import { Module } from '@nestjs/common';
import { AgriInputsController } from './agri-inputs.controller';
import { AgriInputsService } from './agri-inputs.service';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Phase 6 — the products a season may use, and their stock.
 *
 * Kept out of `CropCareModule` on purpose: crop care *uses* these products, but
 * what is allowed in a season and how much is left is a different question, with
 * a different audience (an admin entering leftovers vs. anyone logging work).
 */
@Module({
  imports: [PrismaModule],
  controllers: [AgriInputsController],
  providers: [AgriInputsService],
})
export class AgriInputsModule {}
