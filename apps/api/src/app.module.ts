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
import { AuthModule } from './modules/auth/auth.module.js';
import { EmployeesModule } from './modules/employees/employees.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { SettingsApiModule } from './modules/settings/settings.module.js';
import { TemplatesModule } from './modules/templates/templates.module.js';
import { UsersModule } from './modules/users/users.module.js';

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
    SettingsApiModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
