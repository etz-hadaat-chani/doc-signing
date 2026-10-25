import type { RoundStatus } from '@doc-signing/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import type { DailyRound } from './daily-reminder.rules.js';
import type { SigningEmailType } from './round-send.repository.js';

/** The round row as the daily job locks it, with the database clock. */
export interface DailyRoundRow extends DailyRound {
  id: string;
  status: RoundStatus;
  remindersEnabled: boolean;
  linkExpiresAt: Date | null;
  now: Date;
}

/** A `queued` invitation or reminder row old enough that its job may have died. */
export interface StaleEmailRow {
  id: string;
  type: SigningEmailType;
}

/** Rows the sweep looks at in one run; any left over are seen the next day. */
const SWEEP_LIMIT = 1000;

/**
 * The daily reminder job's queries (3.14). The rows themselves are locked and read with
 * `RoundActionsRepository.lockRows`, the same facts the manager's reminder uses; status changes
 * stay in `RoundSendRepository` (the email job's settling).
 */
@Injectable()
export class DailyRemindersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Rounds that may have someone to remind: `sending` / `active`, reminders on, the link not
   * expired, at least one `sent` / `opened` row. Oldest first. No lock (each is locked again).
   */
  async roundsToRemind(db: Db = this.prisma): Promise<string[]> {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT r.id FROM rounds r
      WHERE r.status IN ('sending', 'active') AND r.reminders_enabled
        AND r.link_expires_at > now()
        AND EXISTS (
          SELECT 1 FROM assignments a
          WHERE a.round_id = r.id AND a.status IN ('sent', 'opened'))
      ORDER BY r.created_at, r.id`;
    return rows.map(({ id }) => id);
  }

  /**
   * Locks the round row (FOR UPDATE, the order every action and email job uses) and reads its
   * reminder settings; null when there is no such round.
   */
  async lockRound(roundId: string, db: Db): Promise<DailyRoundRow | null> {
    const rows = await db.$queryRaw<DailyRoundRow[]>`
      SELECT id, status::text AS status, reminders_enabled AS "remindersEnabled",
             reminder_interval_days AS "reminderIntervalDays", max_reminders AS "maxReminders",
             link_expires_at AS "linkExpiresAt", now() AS now
      FROM rounds WHERE id = ${roundId}::uuid
      FOR UPDATE`;
    return rows[0] ?? null;
  }

  /**
   * `queued` invitation and reminder rows created more than `minutes` ago (database clock),
   * oldest first. The caller still checks each one's job: only a dead job's row is settled.
   * Signed copies are left alone (their own markers, 3.13).
   */
  async staleQueuedEmails(minutes: number, db: Db = this.prisma): Promise<StaleEmailRow[]> {
    return db.$queryRaw<StaleEmailRow[]>`
      SELECT id, type::text AS type FROM email_messages
      WHERE status = 'queued' AND type IN ('invite', 'reminder')
        AND created_at < now() - make_interval(mins => ${minutes}::int)
      ORDER BY created_at, id
      LIMIT ${SWEEP_LIMIT}`;
  }
}
