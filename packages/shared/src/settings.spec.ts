import { describe, expect, it } from 'vitest';
import { formatDate } from './field-values.js';
import {
  hrContactSchema,
  linkExpiresAtFrom,
  REMINDER_SKIP_DATES_MAX,
  reminderSkipDatesSchema,
  senderNameSchema,
  settingsUpdateSchema,
} from './settings.js';

describe('linkExpiresAtFrom', () => {
  it('adds the days as 24-hour periods to the send moment', () => {
    const sentAt = new Date('2026-11-02T08:15:00Z');
    expect(linkExpiresAtFrom(sentAt, 60).toISOString()).toBe('2027-01-01T08:15:00.000Z');
  });

  it('shows the Israeli day near midnight, not the UTC one', () => {
    // 23:30 in Israel (UTC+2): the same day in UTC too.
    expect(formatDate(linkExpiresAtFrom(new Date('2026-10-28T21:30:00Z'), 3))).toBe('31/10/2026');
    // 00:30 in Israel is still the day before in UTC: Israel's day is shown.
    expect(formatDate(linkExpiresAtFrom(new Date('2026-10-28T22:30:00Z'), 3))).toBe('01/11/2026');
  });

  it('keeps 24-hour days across the end of summer time', () => {
    // Sent 23:30 Israel (UTC+3) on 20/10; summer time ends 25/10, so 7 × 24 h is 22:30 (UTC+2).
    const expiresAt = linkExpiresAtFrom(new Date('2026-10-20T20:30:00Z'), 7);
    expect(expiresAt.toISOString()).toBe('2026-10-27T20:30:00.000Z');
    expect(formatDate(expiresAt)).toBe('27/10/2026');
  });
});

describe('settingsUpdateSchema', () => {
  it('accepts each value at its limits', () => {
    for (const body of [
      { reminderIntervalDays: 1 },
      { reminderIntervalDays: 30 },
      { maxReminders: 1 },
      { maxReminders: 50 },
      { maxReminders: null },
      { linkExpiryDays: 1 },
      { linkExpiryDays: 365 },
      { senderName: 'משאבי אנוש' },
    ]) {
      expect(settingsUpdateSchema.safeParse(body).success, JSON.stringify(body)).toBe(true);
    }
  });

  it('trims the sender name', () => {
    expect(settingsUpdateSchema.parse({ senderName: '  משאבי אנוש ' })).toEqual({
      senderName: 'משאבי אנוש',
    });
  });

  it.each([
    ['an empty body', {}],
    ['an unknown field', { reminderIntervalDays: 3, colour: 'red' }],
    ['interval 0', { reminderIntervalDays: 0 }],
    ['interval 31', { reminderIntervalDays: 31 }],
    ['interval 1.5', { reminderIntervalDays: 1.5 }],
    ['interval as text', { reminderIntervalDays: '3' }],
    ['interval null', { reminderIntervalDays: null }],
    ['max reminders 0', { maxReminders: 0 }],
    ['max reminders 51', { maxReminders: 51 }],
    ['expiry 0', { linkExpiryDays: 0 }],
    ['expiry 366', { linkExpiryDays: 366 }],
    ['an empty sender name', { senderName: '   ' }],
    ['a sender name on two lines', { senderName: 'שם\nBcc: x@example.com' }],
    ['a too-long sender name', { senderName: 'א'.repeat(101) }],
  ])('refuses %s', (_label, body) => {
    expect(settingsUpdateSchema.safeParse(body).success).toBe(false);
  });
});

describe('senderNameSchema', () => {
  it('allows 100 characters', () => {
    expect(senderNameSchema.safeParse('א'.repeat(100)).success).toBe(true);
  });
});

describe('hrContactSchema', () => {
  it('trims, lowercases the email and accepts phone, email or both', () => {
    expect(
      hrContactSchema.parse({ name: ' משאבי אנוש ', phone: '02-6543210', email: null }),
    ).toEqual({
      name: 'משאבי אנוש',
      phone: '02-6543210',
      email: null,
    });
    expect(hrContactSchema.parse({ name: 'א', phone: null, email: ' HR@X.org ' }).email).toBe(
      'hr@x.org',
    );
  });

  it('refuses neither phone nor email, with its own code', () => {
    const result = hrContactSchema.safeParse({ name: 'א', phone: null, email: null });
    expect(result.error?.issues[0]?.message).toBe('HR_CONTACT_PHONE_OR_EMAIL');
  });

  it.each([
    { name: '', phone: '02-6543210', email: null },
    { name: 'א\nב', phone: '02-6543210', email: null },
    { name: 'א', phone: 'call me', email: null },
    { name: 'א', phone: null, email: 'not-an-email' },
    { name: 'א', phone: '02-6543210' },
  ])('refuses %j', (value) => {
    expect(hrContactSchema.safeParse(value).success).toBe(false);
  });
});

describe('reminderSkipDatesSchema', () => {
  it('accepts real dates and returns them sorted', () => {
    expect(reminderSkipDatesSchema.parse(['2026-10-14', '2026-09-23', '2028-02-29'])).toEqual([
      '2026-09-23',
      '2026-10-14',
      '2028-02-29',
    ]);
    expect(reminderSkipDatesSchema.parse([])).toEqual([]);
  });

  it('accepts at most the limit', () => {
    const start = Date.UTC(2027, 0, 1);
    const days = (count: number) =>
      Array.from({ length: count }, (_, i) =>
        new Date(start + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      );
    expect(reminderSkipDatesSchema.safeParse(days(REMINDER_SKIP_DATES_MAX)).success).toBe(true);
    expect(reminderSkipDatesSchema.safeParse(days(REMINDER_SKIP_DATES_MAX + 1)).success).toBe(
      false,
    );
  });

  it.each([
    ['a day that does not exist', ['2026-02-30']],
    ['not a leap year', ['2027-02-29']],
    ['month 13', ['2026-13-01']],
    ['another format', ['14/10/2026']],
    ['a time', ['2026-10-14T00:00:00Z']],
    ['a duplicate', ['2026-10-14', '2026-10-14']],
    ['not a list', '2026-10-14'],
  ])('refuses %s', (_, value) => {
    expect(reminderSkipDatesSchema.safeParse(value).success).toBe(false);
  });

  it('is part of the settings update', () => {
    expect(settingsUpdateSchema.parse({ reminderSkipDates: ['2026-10-14'] })).toEqual({
      reminderSkipDates: ['2026-10-14'],
    });
  });
});
