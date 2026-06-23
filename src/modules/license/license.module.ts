import { Module } from '@nestjs/common';
import { LicenseController } from './license.controller';
import { LicenseService } from './license.service';
import { LicenseStore } from './license-store.service';
import { DuitkuService } from './duitku.service';

@Module({
  controllers: [LicenseController],
  providers: [LicenseService, LicenseStore, DuitkuService],
  exports: [LicenseService, LicenseStore],
})
export class LicenseModule {}
