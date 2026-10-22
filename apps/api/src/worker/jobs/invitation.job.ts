import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { INVITATION_QUEUE } from '../../common/queue/queue.definitions.js';
import { QueueService } from '../../common/queue/queue.service.js';
import { SigningEmailSender } from '../../modules/rounds/signing-email-sender.service.js';

/**
 * Jobs fetched at once: with a backlog the worker fetches again with no pause, so a round of
 * 1,500 goes out at the send rate, not one job per poll. Still one email at a time, each job
 * settled on its own.
 */
const BATCH_SIZE = 10;

/**
 * Sends the invitations a round send queued (INVITATION_QUEUE, 3.10); the send rate is kept by
 * EmailService. The work itself is `SigningEmailSender`.
 */
@Injectable()
export class InvitationJob implements OnApplicationBootstrap {
  constructor(
    private readonly queue: QueueService,
    private readonly sender: SigningEmailSender,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.work(INVITATION_QUEUE, (job) => this.sender.run(job), {
      batchSize: BATCH_SIZE,
    });
  }
}
