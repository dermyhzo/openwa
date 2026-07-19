import { Module } from '@nestjs/common';
import { LicenseController } from './license.controller';
import { LicenseService } from './license.service';
import { LicenseStore } from './license-store.service';

@Module({
  controllers: [LicenseController],
  providers: [LicenseService, LicenseStore],
  exports: [LicenseService, LicenseStore],
})
export class LicenseModule {}
