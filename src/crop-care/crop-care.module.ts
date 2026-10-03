import { Module } from '@nestjs/common';
import { CropCareController } from './crop-care.controller';
import { CropCareService } from './crop-care.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CropCareController],
  providers: [CropCareService],
  exports: [CropCareService],
})
export class CropCareModule {}
