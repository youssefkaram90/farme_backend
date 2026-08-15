import { Module } from '@nestjs/common';
import { TunnelsService } from './tunnels.service';
import { TunnelsController } from './tunnels.controller';

@Module({
  controllers: [TunnelsController],
  providers: [TunnelsService],
  exports: [TunnelsService],
})
export class TunnelsModule {}
