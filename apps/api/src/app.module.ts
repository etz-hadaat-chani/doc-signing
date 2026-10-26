import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuditModule } from './common/audit/audit.module.js';
import { ConfigModule } from './common/config/config.module.js';
import { EmailModule } from './common/email/email.module.js';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { PrismaModule } from './common/prisma/prisma.module.js';
import { QueueModule } from './common/queue/queue.module.js';
import { SettingsModule } from './common/settings/settings.module.js';
import { StorageModule } from './common/storage/storage.module.js';
import { ApprovalsModule } from './modules/approvals/approvals.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { EmployeesModule } from './modules/employees/employees.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { ManualHandlingModule } from './modules/manual-handling/manual-handling.module.js';
import { RoundsModule } from './modules/rounds/rounds.module.js';
import { SettingsApiModule } from './modules/settings/settings.module.js';
import { SigningModule } from './modules/signing/signing.module.js';
import { TemplatesModule } from './modules/templates/templates.module.js';
import { TrackingModule } from './modules/tracking/tracking.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { WebhooksModule } from './modules/webhooks/webhooks.module.js';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    QueueModule.forRoot({ mode: 'api' }),
    AuditModule,
    SettingsModule,
    StorageModule,
    EmailModule,
    HealthModule,
    AuthModule,
    UsersModule,
    EmployeesModule,
    TemplatesModule,
    RoundsModule,
    TrackingModule,
    SettingsApiModule,
    SigningModule,
    WebhooksModule,
    ManualHandlingModule,
    ApprovalsModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
