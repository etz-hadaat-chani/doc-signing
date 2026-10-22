import {
  type AssignmentCancelled,
  type AssignmentEmailQueued,
  type AssignmentUnlocked,
  MAX_UNLOCKS,
  REMIND_SKIP_REASONS,
  REMINDABLE_STATUSES,
  type RemindSkipReason,
  type RoundCancelled,
  type RoundReminded,
} from '@doc-signing/shared';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import {
  INVITATION_QUEUE,
  type QueueDefinition,
  type InvitationJobData,
  REMINDER_QUEUE,
} from '../../common/queue/queue.definitions.js';
import { QueueService } from '../../common/queue/queue.service.js';
import type { TemplateActor } from '../templates/templates.service.js';
import {
  type ActionRoundRow,
  type ActionRow,
  RoundActionsRepository,
} from './round-actions.repository.js';
import {
  cancelRefusal,
  type Refusal,
  remindRefusal,
  remindSkipReason,
  resendRefusal,
  roundCancelRefusal,
  roundRemindRefusal,
  unlockRefusal,
} from './round-actions.rules.js';
import { RoundSendRepository, type SigningEmailType } from './round-send.repository.js';

/** Like the send (3.10): READ COMMITTED; the round row lock makes actions on a round run in turn. */
const ACTION_TRANSACTION = { maxWait: 10_000, timeout: 30_000 } as const;

const conflict = ({ code, details }: Refusal) =>
  new AppException(code, HttpStatus.CONFLICT, details);

/**
 * The manager's round actions (3.12, PRD §11, FR-REM-3, FR-RND-7): remind, resend, unlock and
 * cancel, for one employee or the whole round. One transaction each: the round row locked, then
 * its assignments (the send's and the email job's order), the rules (`round-actions.rules.ts`),
 * the changes (`RoundActionsRepository`), the new email rows and their jobs (pg-boss
 * `fromPrisma`, so they commit together or not at all), one audit row. The emails go out in the
 * worker (`SigningEmailSender`), with the 3.10 steps.
 */
@Injectable()
export class RoundActionsService {
  private readonly logger = new Logger(RoundActionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: RoundActionsRepository,
    private readonly emails: RoundSendRepository,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
  ) {}

  /** A reminder to one employee now, with a new link; the older links keep working. */
  remind(assignmentId: string, actor: TemplateActor): Promise<AssignmentEmailQueued> {
    return this.onAssignment(assignmentId, async ({ round, row }, tx) => {
      const refusal = remindRefusal(row, round);
      if (refusal) throw conflict(refusal);
      const [emailMessageId] = await this.queueEmails('reminder', [row], tx);
      await this.audit.record(
        {
          actor: { type: 'user', userId: actor.userId },
          action: 'assignment.remind_queued',
          entity: { type: 'assignment', id: row.id },
          ip: actor.ip,
          details: { roundId: round.id, emailMessageId: must(emailMessageId) },
        },
        tx,
      );
      return {
        assignmentId: row.id,
        roundId: round.id,
        emailMessageId: must(emailMessageId),
        status: row.status,
      } satisfies AssignmentEmailQueued;
    });
  }

  /**
   * A new invitation after a failed send (`pending`) or a fixed wrong email (`invalid_email` →
   * `pending` now; the job makes it `sent`).
   */
  resend(assignmentId: string, actor: TemplateActor): Promise<AssignmentEmailQueued> {
    return this.onAssignment(assignmentId, async ({ round, row }, tx) => {
      const refusal = resendRefusal(row, round);
      if (refusal) throw conflict(refusal);
      if (row.status === 'invalid_email') await this.repository.reopenForResend(row.id, tx);
      const [emailMessageId] = await this.queueEmails('invite', [row], tx);
      await this.audit.record(
        {
          actor: { type: 'user', userId: actor.userId },
          action: 'assignment.resend_queued',
          entity: { type: 'assignment', id: row.id },
          ip: actor.ip,
          details: {
            roundId: round.id,
            emailMessageId: must(emailMessageId),
            fromStatus: row.status,
          },
        },
        tx,
      );
      return {
        assignmentId: row.id,
        roundId: round.id,
        emailMessageId: must(emailMessageId),
        status: 'pending',
      } satisfies AssignmentEmailQueued;
    });
  }

  /**
   * Lifts the lock after 5 wrong ID attempts (`failed_attempts` back to 0); at most
   * `MAX_UNLOCKS` times per assignment, counted from the audit rows under the row lock.
   */
  unlock(assignmentId: string, actor: TemplateActor): Promise<AssignmentUnlocked> {
    return this.onAssignment(assignmentId, async ({ round, row }, tx) => {
      const previousUnlocks = await this.repository.unlockCount(row.id, tx);
      const refusal = unlockRefusal(row, round, previousUnlocks);
      if (refusal) throw conflict(refusal);
      await this.repository.unlock(row.id, tx);
      await this.audit.record(
        {
          actor: { type: 'user', userId: actor.userId },
          action: 'assignment.unlocked',
          entity: { type: 'assignment', id: row.id },
          ip: actor.ip,
          details: {
            roundId: round.id,
            lockedAt: (row.lockedAt ?? round.now).toISOString(),
            failedAttempts: row.failedAttempts,
            previousUnlocks,
          },
        },
        tx,
      );
      return {
        assignmentId: row.id,
        roundId: round.id,
        status: row.status,
        unlocksLeft: Math.max(0, MAX_UNLOCKS - previousUnlocks - 1),
      } satisfies AssignmentUnlocked;
    });
  }

  /** Cancels one employee's assignment: every link of it stops at once ("cancelled"). */
  cancel(assignmentId: string, actor: TemplateActor): Promise<AssignmentCancelled> {
    return this.onAssignment(assignmentId, async ({ round, row }, tx) => {
      const refusal = cancelRefusal(row, round);
      if (refusal) throw conflict(refusal);
      await this.repository.cancelOne(row.id, tx);
      await this.audit.record(
        {
          actor: { type: 'user', userId: actor.userId },
          action: 'assignment.cancelled',
          entity: { type: 'assignment', id: row.id },
          ip: actor.ip,
          details: { roundId: round.id, fromStatus: row.status },
        },
        tx,
      );
      return {
        assignmentId: row.id,
        roundId: round.id,
        status: 'cancelled',
      } satisfies AssignmentCancelled;
    });
  }

  /**
   * Reminds everyone in the round who got the document and hasn't signed (FR-REM-3), skipping
   * the locked, those with no valid email, those with an email still queued and those emailed in
   * the last 24 hours. A second click the same day queues nothing.
   */
  async remindRound(roundId: string, actor: TemplateActor): Promise<RoundReminded> {
    const result = await this.prisma.$transaction(async (tx) => {
      const round = await this.lockRound(roundId, tx);
      const refusal = roundRemindRefusal(round);
      if (refusal) throw conflict(refusal);
      const rows = await this.repository.lockRows({ roundId, statuses: REMINDABLE_STATUSES }, tx);
      const skipped = Object.fromEntries(
        REMIND_SKIP_REASONS.map((reason) => [reason, 0]),
      ) as Record<RemindSkipReason, number>;
      const toRemind: ActionRow[] = [];
      for (const row of rows) {
        const reason = remindSkipReason(row, round);
        if (reason) skipped[reason] += 1;
        else toRemind.push(row);
      }
      await this.queueEmails('reminder', toRemind, tx);
      await this.audit.record(
        {
          actor: { type: 'user', userId: actor.userId },
          action: 'round.remind_queued',
          entity: { type: 'round', id: roundId },
          ip: actor.ip,
          details: { queued: toRemind.length, skipped },
        },
        tx,
      );
      return { roundId, queued: toRemind.length, skipped } satisfies RoundReminded;
    }, ACTION_TRANSACTION);
    this.logger.log(`Round ${roundId}: queued ${String(result.queued)} reminders`);
    return result;
  }

  /**
   * Cancels the round (also a draft) and every open assignment in it; signed ones stay. Queued
   * emails settle as `failed` `ASSIGNMENT_CLOSED` by themselves (their job checks the row).
   */
  cancelRound(roundId: string, actor: TemplateActor): Promise<RoundCancelled> {
    return this.prisma.$transaction(async (tx) => {
      const round = await this.lockRound(roundId, tx);
      const refusal = roundCancelRefusal(round);
      if (refusal) throw conflict(refusal);
      const byStatus = await this.repository.cancelOpenInRound(roundId, tx);
      await this.repository.markRoundCancelled(roundId, round.status, tx);
      const signedUntouched = await this.repository.countSigned(roundId, tx);
      const cancelled = Object.values(byStatus).reduce((sum, count) => sum + count, 0);
      await this.audit.record(
        {
          actor: { type: 'user', userId: actor.userId },
          action: 'round.cancelled',
          entity: { type: 'round', id: roundId },
          ip: actor.ip,
          details: { fromStatus: round.status, cancelled, byStatus, signedUntouched },
        },
        tx,
      );
      return { roundId, status: 'cancelled', cancelled, signedUntouched } satisfies RoundCancelled;
    }, ACTION_TRANSACTION);
  }

  /** The common frame of a one-employee action: 404, round lock, assignment lock. */
  private onAssignment<T>(
    assignmentId: string,
    act: (locked: { round: ActionRoundRow; row: ActionRow }, tx: Db) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const roundId = await this.repository.roundOfAssignment(assignmentId, tx);
      if (!roundId) throw new AppException('ASSIGNMENT_NOT_FOUND', HttpStatus.NOT_FOUND);
      const round = await this.lockRound(roundId, tx);
      const [row] = await this.repository.lockRows({ assignmentId }, tx);
      if (!row) throw new AppException('ASSIGNMENT_NOT_FOUND', HttpStatus.NOT_FOUND);
      return act({ round, row }, tx);
    }, ACTION_TRANSACTION);
  }

  private async lockRound(roundId: string, tx: Db): Promise<ActionRoundRow> {
    const round = await this.repository.lockRound(roundId, tx);
    if (!round) throw new AppException('ROUND_NOT_FOUND', HttpStatus.NOT_FOUND);
    return round;
  }

  /**
   * One `queued` row per assignment (to its employee's current valid email) and one job each,
   * inside the transaction. The exclusive queue refusing a job (the previous job of the same
   * employee is still finishing) rolls everything back: 409, never two emails at once.
   */
  private async queueEmails(
    type: SigningEmailType,
    rows: readonly ActionRow[],
    tx: Db,
  ): Promise<string[]> {
    if (rows.length === 0) return [];
    const created = await this.emails.createSigningEmails(
      type,
      rows.map((row) => ({ assignmentId: row.id, toEmail: must(row.validEmail) })),
      tx,
    );
    const queue: QueueDefinition<InvitationJobData> =
      type === 'reminder' ? REMINDER_QUEUE : INVITATION_QUEUE;
    const added = await this.queue.sendMany(
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

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error('A value the rules checked is missing');
  return value;
}
