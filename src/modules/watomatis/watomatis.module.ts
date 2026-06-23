import { Module } from '@nestjs/common';
import { MessageModule } from '../message/message.module';
import { WatomatisController } from './watomatis.controller';
import { WatomatisService } from './watomatis.service';
import { WatomatisStore } from './watomatis-store.service';
import { WatomatisDraftStore } from './watomatis-drafts.service';
import { WatomatisRuntime } from './watomatis-runtime.service';

@Module({
  imports: [MessageModule],
  controllers: [WatomatisController],
  providers: [WatomatisService, WatomatisStore, WatomatisDraftStore, WatomatisRuntime],
  exports: [WatomatisService, WatomatisStore],
})
export class WatomatisModule {}
