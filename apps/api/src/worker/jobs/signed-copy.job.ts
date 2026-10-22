import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { SIGNED_COPY_QUEUE } from '../../common/queue/queue.definitions.js';
import { QueueService } from '../../common/queue/queue.service.js';
import { SignedCopySender } from '../../modules/signing/signed-copy-sender.service.js';

/** Sends the signed copy of each signed document (SIGNED_COPY_QUEUE, 3.13). */
@Injectable()
export class SignedCopyJob implements OnApplicationBootstrap {
  constructor(
    private readonly queue: QueueService,
    private readonly sender: SignedCopySender,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.work(SIGNED_COPY_QUEUE, (job) => this.sender.run(job));
  }
}
