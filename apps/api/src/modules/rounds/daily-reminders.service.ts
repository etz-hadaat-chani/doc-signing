import {
  DAILY_REMIND_SKIP_REASONS,
  type DailyRemindSkipReason,
  REMINDABLE_STATUSES,
} from '@doc-signing/shared';
import { Injectable, Logger } from '@nestjs/common';
import type { AuditDetailsMap } from '../../common/audit/audit.actions.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import { INVITATION_QUEUE, REMINDER_QUEUE } from '../../common/queue/queue.definitions.js';
import { QueueService } from '../../common/queue/queue.service.js';
import { SettingsService } from '../../common/settings/settings.service.js';
import { dailyReminderSkip, israelDayAhead } from './daily-reminder.rules.js';
import { type DailyRoundRow, DailyRemindersRepository } from './daily-reminders.repository.js';
import { type ActionRow, RoundActionsRepository } from './round-actions.repository.js';
import { SigningEmailQueue } from './signing-email-queue.js';
import { SigningEmailSender } from './signing-email-sender.service.js';

/** Like the manager's actions (3.12): READ COMMITTED, the round row lock first. */
const ROUND_TRANSACTION = { maxWait: 10_000, timeout: 30_000 } as const;

/**
 * A `queued` row older than this whose job is no longer waiting or running was lost. The longest
 * a live job takes with its retries is about 1 h 45 min (6 attempts of up to 15 min, plus ~15 min
 * of backoff), and the job's state is checked as well, so a row still being sent is never hit.
 */
export const STALE_AFTER_MINUTES = 120;

export type DailyRunDetails = AuditDetailsMap['reminders.daily_run'];

/** What one run is asked to do. */
export interface DailyRunInput {
  now?: Date;
  trigger?: 'schedule' | 'manual';
  /** Development only (the job class drops it in production): "today" is this many days later. */
  daysAhead?: number;
}

type Counts = Record<DailyRemindSkipReason, number>;

const noCounts = (): Counts =>
  Object.fromEntries(DAILY_REMIND_SKIP_REASONS.map((reason) => [reason, 0])) as Counts;

/** The round can take daily reminders now (checked again under its lock). */
const roundOpen = (round: DailyRoundRow): boolean =>
  (round.status === 'sending' || round.status === 'active') &&
  round.remindersEnabled &&
  round.linkExpiresAt !== null &&
  round.linkExpiresAt.getTime() > round.now.getTime();

/** The refusal of the exclusive reminder queue (`SigningEmailQueue`): someone's job is busy. */
const isBusy = (error: unknown): boolean =>
  error instanceof AppException && error.code === 'EMAIL_ALREADY_QUEUED';

/**
 * The daily reminders (3.14, FR-REM-1, Flow 5), run by the worker at 09:00 Sunday to Thursday.
 * 1. The sweep: queued invitations and reminders whose job died are settled (`settleLost`), so
 *    a `sending` round can finish and the employee can be reminded.
 * 2. Today is a no-reminder date (`reminder_skip_dates`) → nothing else.
 * 3. Each round that may have someone due, in its own transaction: the round row locked, then its
 *    `sent` / `opened` rows (`lockRows`, the manager's reminder's facts), `dailyReminderSkip` per
 *    row, one `queued` reminder row + job per due row (`SigningEmailQueue`). The worker sends
 *    them (`SigningEmailSender`) at the send rate.
 * 4. One audit row with counts only.
 * Safe to run twice: whoever was reminded has a queued row or was emailed today, and the round
 * lock makes two runs take turns.
 */
@Injectable()
export class DailyRemindersService {
  private readonly logger = new Logger(DailyRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: DailyRemindersRepository,
    private readonly rows: RoundActionsRepository,
    private readonly emails: SigningEmailQueue,
    private readonly sender: SigningEmailSender,
    private readonly jobs: QueueService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async run(input: DailyRunInput = {}): Promise<DailyRunDetails> {
    const now = input.now ?? new Date();
    const swept = await this.sweep();
    const day = israelDayAhead(now, input.daysAhead ?? 0);
    const details: DailyRunDetails = {
      trigger: input.trigger ?? 'schedule',
      day,
      skipped: null,
      rounds: 0,
      queued: 0,
      notReminded: noCounts(),
      byRound: [],
      swept,
    };
    if ((await this.settings.getReminderSkipDates()).includes(day)) {
      details.skipped = 'skip_date';
    } else {
      for (const roundId of await this.repository.roundsToRemind()) {
        const result = await this.remindRound(roundId, day);
        if (!result) continue;
        details.rounds += 1;
        details.queued += result.queued;
        for (const reason of DAILY_REMIND_SKIP_REASONS) {
          details.notReminded[reason] += result.notReminded[reason];
        }
        if (result.queued > 0) details.byRound.push({ roundId, queued: result.queued });
      }
    }
    await this.audit.record({
      actor: { type: 'system' },
      action: 'reminders.daily_run',
      entity: { type: 'job', id: null },
      ip: null,
      details,
    });
    const outcome = details.skipped
      ? 'a no-reminder date, nothing queued'
      : `queued ${String(details.queued)} in ${String(details.rounds)} rounds`;
    this.logger.log(
      `Daily reminders ${day}: ${outcome}; swept ${String(swept.failed + swept.unconfirmed)}`,
    );
    return details;
  }

  /**
   * One round in one transaction. The exclusive queue refusing one job (that employee's previous
   * reminder is just finishing) rolls it back; the round is then done one employee at a time, so
   * one busy employee never holds back the others. Null when the round can't take reminders now.
   */
  private async remindRound(
    roundId: string,
    day: string,
  ): Promise<{ queued: number; notReminded: Counts } | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await this.lockOpenRound(roundId, tx);
        if (!locked) return null;
        const rows = await this.rows.lockRows({ roundId, statuses: REMINDABLE_STATUSES }, tx);
        const { due, notReminded } = this.split(rows, locked, day);
        await this.queueReminders(due, tx);
        return { queued: due.length, notReminded };
      }, ROUND_TRANSACTION);
    } catch (error) {
      if (!isBusy(error)) throw error;
      return this.remindOneByOne(roundId, day);
    }
  }

  private async remindOneByOne(
    roundId: string,
    day: string,
  ): Promise<{ queued: number; notReminded: Counts } | null> {
    const first = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockOpenRound(roundId, tx);
      if (!locked) return null;
      const rows = await this.rows.lockRows({ roundId, statuses: REMINDABLE_STATUSES }, tx);
      return this.split(rows, locked, day);
    }, ROUND_TRANSACTION);
    if (!first) return null;
    const { notReminded } = first;
    let queued = 0;
    for (const { id } of first.due) {
      try {
        const reason = await this.prisma.$transaction(async (tx) => {
          const locked = await this.lockOpenRound(roundId, tx);
          if (!locked) return 'gone' as const;
          const [row] = await this.rows.lockRows({ assignmentId: id }, tx);
          if (!row || !(REMINDABLE_STATUSES as readonly string[]).includes(row.status)) {
            return 'gone' as const;
          }
          const skip = dailyReminderSkip(row, locked, day);
          if (!skip) await this.queueReminders([row], tx);
          return skip;
        }, ROUND_TRANSACTION);
        if (reason === null) queued += 1;
        else if (reason !== 'gone') notReminded[reason] += 1;
      } catch (error) {
        if (!isBusy(error)) throw error;
        notReminded.busy += 1;
      }
    }
    return { queued, notReminded };
  }

  private async lockOpenRound(roundId: string, tx: Db): Promise<DailyRoundRow | null> {
    const round = await this.repository.lockRound(roundId, tx);
    return round && roundOpen(round) ? round : null;
  }

  private split(rows: readonly ActionRow[], round: DailyRoundRow, day: string) {
    const notReminded = noCounts();
    const due: ActionRow[] = [];
    for (const row of rows) {
      const reason = dailyReminderSkip(row, round, day);
      if (reason) notReminded[reason] += 1;
      else due.push(row);
    }
    return { due, notReminded };
  }

  private async queueReminders(rows: readonly ActionRow[], tx: Db): Promise<void> {
    await this.emails.queue(
      'reminder',
      rows.map((row) => {
        if (row.validEmail === null) throw new Error('A due row has no valid email');
        return { assignmentId: row.id, toEmail: row.validEmail };
      }),
      tx,
    );
  }

  /**
   * Queued invitations and reminders older than `STALE_AFTER_MINUTES` whose job is no longer
   * waiting, retrying or running: settled as `failed` `JOB_LOST` (or `sent` `UNCONFIRMED` when a
   * hash was stored), each in its own transaction with the round lock (`settleLost`).
   */
  private async sweep(): Promise<DailyRunDetails['swept']> {
    const swept = { failed: 0, unconfirmed: 0, roundsFinished: 0 };
    for (const row of await this.repository.staleQueuedEmails(STALE_AFTER_MINUTES)) {
      const queue = row.type === 'reminder' ? REMINDER_QUEUE : INVITATION_QUEUE;
      if (await this.jobs.hasLiveJob(queue, { emailMessageId: row.id })) continue;
      const outcome = await this.sender.settleLost(row.id);
      if (outcome.settled === 'failed') swept.failed += 1;
      if (outcome.settled === 'sent') swept.unconfirmed += 1;
      if (outcome.roundFinished) swept.roundsFinished += 1;
    }
    return swept;
  }
}
