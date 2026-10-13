import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuditModule } from './common/audit/audit.module.js';
import { ConfigModule } from './common/config/config.module.js';
import { EmailModule } from './common/email/email.module.js';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { PrismaModule } from './common/prisma/prisma.module.js';
import { SettingsModule } from './common/settings/settings.module.js';
import { StorageModule } from './common/storage/storage.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuditModule,
    SettingsModule,
    StorageModule,
    EmailModule,
    HealthModule,
    AuthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
