import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { CLEANUP_QUEUE, SCHEDULE_TIME_ZONE } from '../../common/queue/queue.definitions.js';
import { QueueService } from '../../common/queue/queue.service.js';
import { AuthCleanupService } from '../../modules/auth/auth-cleanup.service.js';

/** Daily cleanup of expired sessions and old login attempts (CLEANUP_QUEUE, daily 03:00). */
@Injectable()
export class CleanupJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(CleanupJob.name);

  constructor(
    private readonly queue: QueueService,
    private readonly cleanup: AuthCleanupService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.work(CLEANUP_QUEUE, () => this.run());
    await this.queue.schedule(CLEANUP_QUEUE);
    this.logger.log(
      `Cleanup scheduled ${CLEANUP_QUEUE.schedule?.description ?? ''} (${SCHEDULE_TIME_ZONE})`,
    );
  }

  async run(now = new Date()): Promise<void> {
    const { sessions, loginAttempts, signingSessions, signingRateHits } =
      await this.cleanup.deleteExpired(now);
    this.logger.log(
      `Cleanup: deleted ${sessions} sessions, ${loginAttempts} login attempts, ` +
        `${signingSessions} signing sessions, ${signingRateHits} signing rate counters`,
    );
  }
}
