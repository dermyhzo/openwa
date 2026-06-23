import { Module } from '@nestjs/common';
import { MessageModule } from '../message/message.module';
import { SessionModule } from '../session/session.module';
import { WatomatisController } from './watomatis.controller';
import { WatomatisService } from './watomatis.service';
import { WatomatisStore } from './watomatis-store.service';
import { WatomatisSettingsStore } from './watomatis-settings-store.service';
import { WatomatisDraftStore } from './watomatis-drafts.service';
import { WatomatisRuntime } from './watomatis-runtime.service';
import { WatomatisRecordingStore } from './watomatis-recording-store.service';
import { WatomatisRecorder } from './watomatis-recorder.service';
import { ShippingConnector } from './connectors/shipping.connector';

@Module({
  imports: [MessageModule, SessionModule],
  controllers: [WatomatisController],
  providers: [
    WatomatisService,
    WatomatisStore,
    WatomatisSettingsStore,
    WatomatisDraftStore,
    WatomatisRuntime,
    WatomatisRecordingStore,
    WatomatisRecorder,
    ShippingConnector,
  ],
  exports: [WatomatisService, WatomatisStore, WatomatisSettingsStore, WatomatisRecordingStore, ShippingConnector],
})
export class WatomatisModule {}
