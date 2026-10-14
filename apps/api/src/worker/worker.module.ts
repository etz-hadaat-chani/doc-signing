import { Module } from '@nestjs/common';
import { ConfigModule } from '../common/config/config.module.js';
import { PrismaModule } from '../common/prisma/prisma.module.js';
import { QueueModule } from '../common/queue/queue.module.js';
import { AuthCleanupService } from '../modules/auth/auth-cleanup.service.js';
import { CleanupJob } from './jobs/cleanup.job.js';

/**
 * The worker process: no HTTP, runs the jobs the API adds. Each job class registers its handler
 * (and schedule) when the worker starts. A new job: a class in jobs/, listed here.
 */
@Module({
  imports: [ConfigModule, PrismaModule, QueueModule.forRoot({ mode: 'worker' })],
  providers: [AuthCleanupService, CleanupJob],
})
export class WorkerModule {}
