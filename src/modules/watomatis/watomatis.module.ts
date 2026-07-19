import { Module } from '@nestjs/common';
import { MessageModule } from '../message/message.module';
import { SessionModule } from '../session/session.module';
import { LicenseModule } from '../license/license.module';
import { WatomatisController } from './watomatis.controller';
import { WatomatisService } from './watomatis.service';
import { WatomatisStore } from './watomatis-store.service';
import { WatomatisSettingsStore } from './watomatis-settings-store.service';
import { WatomatisDraftStore } from './watomatis-drafts.service';
import { WatomatisRuntime } from './watomatis-runtime.service';
import { WatomatisRecordingStore } from './watomatis-recording-store.service';
import { WatomatisRecorder } from './watomatis-recorder.service';
import { ShippingConnector } from './connectors/shipping.connector';
import { ScalevConnector } from './connectors/scalev.connector';
import { WatomatisOrderStore } from './watomatis-order-store.service';
import { LicenseIssuerService } from './license-issuer.service';

@Module({
  imports: [MessageModule, SessionModule, LicenseModule],
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
    ScalevConnector,
    WatomatisOrderStore,
    LicenseIssuerService,
  ],
  exports: [WatomatisService, WatomatisStore, WatomatisSettingsStore, WatomatisRecordingStore, ShippingConnector],
})
export class WatomatisModule {}
