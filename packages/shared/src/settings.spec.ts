import { describe, expect, it } from 'vitest';
import { senderNameSchema, settingsUpdateSchema } from './settings.js';

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
