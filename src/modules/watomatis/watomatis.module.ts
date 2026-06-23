import { Module } from '@nestjs/common';
import { WatomatisController } from './watomatis.controller';
import { WatomatisService } from './watomatis.service';
import { WatomatisStore } from './watomatis-store.service';

@Module({
  controllers: [WatomatisController],
  providers: [WatomatisService, WatomatisStore],
  exports: [WatomatisService, WatomatisStore],
})
export class WatomatisModule {}
