import { type DailyRemindSkipReason, todayInIsrael } from '@doc-signing/shared';
import type { ActionTarget } from './round-actions.rules.js';

/**
 * Who the daily reminder job (3.14, FR-REM-1) reminds: pure rules, no database. The job reads
 * the facts with the round and its `sent` / `opened` rows locked, the same way the manager's
 * "remind everyone" does (3.12), and asks this rule about each row.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The round's reminder settings (FR-RND-5). */
export interface DailyRound {
  reminderIntervalDays: number;
  /** null = no limit. */
  maxReminders: number | null;
}

/** One `sent` / `opened` assignment and what the daily rule needs to know about it. */
export interface DailyTarget extends ActionTarget {
  /** Reminders that went out, manual ones too. */
  reminderCount: number;
  /** When she was last emailed a link (invitation or reminder that didn't fail). */
  lastSentAt: Date | null;
}

/** `YYYY-MM-DD` → days since 1970-01-01 (calendar arithmetic, no time zone involved). */
function dayNumber(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
}

/**
 * Calendar days in Israel from `from` to the day `today` (`YYYY-MM-DD`): the time of day doesn't
 * count, so an email at 08:59 and one at 09:01 on the same day are both "that day".
 */
export function israelDayGap(from: Date, today: string): number {
  return dayNumber(today) - dayNumber(todayInIsrael(from));
}

/** The day in Israel `days` after `now` (`daysAhead` in development; 0 otherwise). */
export function israelDayAhead(now: Date, days: number): string {
  return todayInIsrael(new Date(now.getTime() + days * DAY_MS));
}

/**
 * Why the daily job leaves this row out (the first reason that applies), or null when it is due.
 * Due: not locked, a valid email now, no invitation or reminder still queued, under the round's
 * maximum (manual reminders count too), and last emailed at least `reminderIntervalDays`
 * calendar days ago in Israel. Never emailed (no date) counts as due.
 */
export function dailyReminderSkip(
  target: DailyTarget,
  round: DailyRound,
  today: string,
): DailyRemindSkipReason | null {
  if (target.locked) return 'locked';
  if (target.validEmail === null) return 'noValidEmail';
  if (target.emailQueued) return 'emailQueued';
  if (round.maxReminders !== null && target.reminderCount >= round.maxReminders) {
    return 'maxReached';
  }
  if (
    target.lastSentAt !== null &&
    israelDayGap(target.lastSentAt, today) < round.reminderIntervalDays
  ) {
    return 'notDue';
  }
  return null;
}
