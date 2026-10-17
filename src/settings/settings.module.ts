import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * Exported because the sowing services read the figures from it: a new sowing
 * follows the current setting, while the row it writes keeps what it actually used
 * (SOW-11).
 */
@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
