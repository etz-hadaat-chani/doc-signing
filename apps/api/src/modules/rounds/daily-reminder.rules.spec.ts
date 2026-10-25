import { describe, expect, it } from 'vitest';
import {
  type DailyRound,
  type DailyTarget,
  dailyReminderSkip,
  israelDayAhead,
  israelDayGap,
} from './daily-reminder.rules.js';

const round: DailyRound = { reminderIntervalDays: 3, maxReminders: null };

function target(changes: Partial<DailyTarget> = {}): DailyTarget {
  return {
    status: 'sent',
    locked: false,
    validEmail: 'a@example.com',
    emailQueued: false,
    lastEmailAt: null,
    lastEmailFailed: false,
    failedAddress: null,
    reminderCount: 0,
    // Sunday 25/10/2026, 14:00 in Israel (UTC+2 in winter).
    lastSentAt: new Date('2026-10-25T12:00:00Z'),
    ...changes,
  };
}

describe('israelDayGap', () => {
  it('counts calendar days in Israel, not hours', () => {
    // 09:00:30 Wednesday to 09:00:00 Saturday: under 72 hours, still 3 days.
    expect(israelDayGap(new Date('2026-10-28T07:00:30Z'), '2026-10-31')).toBe(3);
    expect(israelDayGap(new Date('2026-10-25T12:00:00Z'), '2026-10-25')).toBe(0);
  });

  it('08:59 and 09:01 on the same day are the same day', () => {
    expect(israelDayGap(new Date('2026-10-25T06:59:00Z'), '2026-10-28')).toBe(3);
    expect(israelDayGap(new Date('2026-10-25T07:01:00Z'), '2026-10-28')).toBe(3);
  });

  it('uses the Israel date, not the UTC date, around midnight', () => {
    // Winter time (UTC+2): 22:30 UTC on the 9th is 00:30 on the 10th in Israel.
    expect(israelDayGap(new Date('2026-11-09T22:30:00Z'), '2026-11-10')).toBe(0);
    // 21:30 UTC on the 9th is 23:30 on the 9th in Israel.
    expect(israelDayGap(new Date('2026-11-09T21:30:00Z'), '2026-11-10')).toBe(1);
  });

  it('is not moved by the summer-time change', () => {
    // Israel leaves summer time on Sunday 25/10/2026 (02:00 → 01:00).
    expect(israelDayGap(new Date('2026-10-23T06:00:00Z'), '2026-10-26')).toBe(3);
    // And enters it on Friday 27/03/2026.
    expect(israelDayGap(new Date('2026-03-25T07:00:00Z'), '2026-03-28')).toBe(3);
  });
});

describe('israelDayAhead', () => {
  it('is today in Israel, or a number of days later', () => {
    const now = new Date('2026-10-25T07:00:00Z');
    expect(israelDayAhead(now, 0)).toBe('2026-10-25');
    expect(israelDayAhead(now, 3)).toBe('2026-10-28');
  });
});

describe('dailyReminderSkip', () => {
  it('reminds once the interval has passed in calendar days', () => {
    expect(dailyReminderSkip(target(), round, '2026-10-27')).toBe('notDue');
    expect(dailyReminderSkip(target(), round, '2026-10-28')).toBeNull();
    expect(dailyReminderSkip(target(), round, '2026-11-15')).toBeNull();
  });

  it('follows the round interval', () => {
    const daily = { ...round, reminderIntervalDays: 1 };
    expect(dailyReminderSkip(target(), daily, '2026-10-25')).toBe('notDue');
    expect(dailyReminderSkip(target(), daily, '2026-10-26')).toBeNull();
  });

  it('stops at the maximum; reminders already sent (manual ones too) count', () => {
    const limited = { ...round, maxReminders: 2 };
    expect(dailyReminderSkip(target({ reminderCount: 1 }), limited, '2026-11-01')).toBeNull();
    expect(dailyReminderSkip(target({ reminderCount: 2 }), limited, '2026-11-01')).toBe(
      'maxReached',
    );
    expect(dailyReminderSkip(target({ reminderCount: 40 }), round, '2026-11-01')).toBeNull();
  });

  it('a row never emailed counts as due', () => {
    expect(dailyReminderSkip(target({ lastSentAt: null }), round, '2026-10-25')).toBeNull();
  });

  it('gives the first reason, in order', () => {
    const all = target({
      locked: true,
      validEmail: null,
      emailQueued: true,
      reminderCount: 5,
    });
    const limited = { ...round, maxReminders: 1 };
    expect(dailyReminderSkip(all, limited, '2026-10-25')).toBe('locked');
    expect(dailyReminderSkip({ ...all, locked: false }, limited, '2026-10-25')).toBe(
      'noValidEmail',
    );
    expect(
      dailyReminderSkip({ ...all, locked: false, validEmail: 'a@b.co' }, limited, '2026-10-25'),
    ).toBe('emailQueued');
    expect(
      dailyReminderSkip(
        { ...all, locked: false, validEmail: 'a@b.co', emailQueued: false },
        limited,
        '2026-10-25',
      ),
    ).toBe('maxReached');
  });
});
