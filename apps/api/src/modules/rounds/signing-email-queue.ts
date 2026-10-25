import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import {
  INVITATION_QUEUE,
  type InvitationJobData,
  type QueueDefinition,
  REMINDER_QUEUE,
} from '../../common/queue/queue.definitions.js';
import { QueueService } from '../../common/queue/queue.service.js';
import { RoundSendRepository, type SigningEmailType } from './round-send.repository.js';

/** One email to queue: the assignment and the address it goes to (the employee's valid email). */
export interface SigningEmailTarget {
  assignmentId: string;
  toEmail: string;
}

/**
 * Queues invitations or reminders inside the caller's transaction (3.12, 3.14): one `queued` row
 * per assignment (no token yet) and one job each (pg-boss `fromPrisma`, so they commit together
 * or not at all). Invitations go on `INVITATION_QUEUE`, reminders on `REMINDER_QUEUE`; job data
 * is ids only, `singletonKey` = the assignment id.
 */
@Injectable()
export class SigningEmailQueue {
  constructor(
    private readonly emails: RoundSendRepository,
    private readonly jobs: QueueService,
  ) {}

  /**
   * Returns the new row ids, in the order given. The exclusive queue refusing a job (the previous
   * job of the same employee is still finishing) throws 409 `EMAIL_ALREADY_QUEUED`: the caller's
   * transaction rolls back, never two emails at once.
   */
  async queue(
    type: SigningEmailType,
    targets: readonly SigningEmailTarget[],
    tx: Db,
  ): Promise<string[]> {
    if (targets.length === 0) return [];
    const created = await this.emails.createSigningEmails(type, targets, tx);
    const queue: QueueDefinition<InvitationJobData> =
      type === 'reminder' ? REMINDER_QUEUE : INVITATION_QUEUE;
    const added = await this.jobs.sendMany(
      queue,
      created.map(({ id, assignmentId }) => ({
        data: { assignmentId, emailMessageId: id },
        singletonKey: assignmentId,
      })),
      tx,
    );
    if (added !== created.length) {
      throw new AppException('EMAIL_ALREADY_QUEUED', HttpStatus.CONFLICT);
    }
    return created.map(({ id }) => id);
  }
}
