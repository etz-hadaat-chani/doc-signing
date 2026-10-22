import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { REMINDER_QUEUE } from '../../common/queue/queue.definitions.js';
import { QueueService } from '../../common/queue/queue.service.js';
import { SigningEmailSender } from '../../modules/rounds/signing-email-sender.service.js';

/** Jobs fetched at once, as for the invitations: a whole-round reminder goes out at the send rate. */
const BATCH_SIZE = 10;

/**
 * Sends the reminders a manager queued (REMINDER_QUEUE, 3.12; the daily job adds its own in
 * 3.14). The work itself is `SigningEmailSender`, the same steps as an invitation.
 */
@Injectable()
export class ReminderJob implements OnApplicationBootstrap {
  constructor(
    private readonly queue: QueueService,
    private readonly sender: SigningEmailSender,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.work(REMINDER_QUEUE, (job) => this.sender.run(job), {
      batchSize: BATCH_SIZE,
    });
  }
}
