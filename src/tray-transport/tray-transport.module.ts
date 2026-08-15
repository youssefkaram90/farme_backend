import { Module } from '@nestjs/common';
import { TrayTransportController } from './tray-transport.controller';
import { TrayTransportService } from './tray-transport.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TrayTransportController],
  providers: [TrayTransportService],
  exports: [TrayTransportService],
})
export class TrayTransportModule {}
