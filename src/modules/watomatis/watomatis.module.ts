import { Module } from '@nestjs/common';
import { MessageModule } from '../message/message.module';
import { WatomatisController } from './watomatis.controller';
import { WatomatisService } from './watomatis.service';
import { WatomatisStore } from './watomatis-store.service';
import { WatomatisDraftStore } from './watomatis-drafts.service';
import { WatomatisRuntime } from './watomatis-runtime.service';
import { WatomatisRecordingStore } from './watomatis-recording-store.service';
import { WatomatisRecorder } from './watomatis-recorder.service';
import { ShippingConnector } from './connectors/shipping.connector';

@Module({
  imports: [MessageModule],
  controllers: [WatomatisController],
  providers: [
    WatomatisService,
    WatomatisStore,
    WatomatisDraftStore,
    WatomatisRuntime,
    WatomatisRecordingStore,
    WatomatisRecorder,
    ShippingConnector,
  ],
  exports: [WatomatisService, WatomatisStore, WatomatisRecordingStore, ShippingConnector],
})
export class WatomatisModule {}
