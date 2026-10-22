import { Module } from '@nestjs/common';
import { AuditModule } from '../common/audit/audit.module.js';
import { ConfigModule } from '../common/config/config.module.js';
import { EmailModule } from '../common/email/email.module.js';
import { PrismaModule } from '../common/prisma/prisma.module.js';
import { QueueModule } from '../common/queue/queue.module.js';
import { SettingsModule } from '../common/settings/settings.module.js';
import { AuthCleanupService } from '../modules/auth/auth-cleanup.service.js';
import { RoundSendRepository } from '../modules/rounds/round-send.repository.js';
import { SigningEmailSender } from '../modules/rounds/signing-email-sender.service.js';
import { CleanupJob } from './jobs/cleanup.job.js';
import { InvitationJob } from './jobs/invitation.job.js';
import { ReminderJob } from './jobs/reminder.job.js';

/**
 * The worker process: no HTTP, runs the jobs the API adds. Each job class registers its handler
 * (and schedule) when the worker starts. A new job: a class in jobs/, listed here.
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    QueueModule.forRoot({ mode: 'worker' }),
    AuditModule,
    SettingsModule,
    EmailModule,
  ],
  providers: [
    AuthCleanupService,
    CleanupJob,
    RoundSendRepository,
    SigningEmailSender,
    InvitationJob,
    ReminderJob,
  ],
})
export class WorkerModule {}
