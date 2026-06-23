import { Module } from '@nestjs/common';
import { WatomatisController } from './watomatis.controller';
import { WatomatisService } from './watomatis.service';

@Module({
  controllers: [WatomatisController],
  providers: [WatomatisService],
  exports: [WatomatisService],
})
export class WatomatisModule {}
