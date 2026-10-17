import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SettingsAdminService } from './settings-admin.service.js';
import { SettingsController } from './settings.controller.js';

/** The settings screen's API (FR-ADM-2). Reading settings elsewhere is the global SettingsService. */
@Module({
  imports: [AuthModule],
  controllers: [SettingsController],
  providers: [SettingsAdminService],
})
export class SettingsApiModule {}
