import { describe, expect, it } from 'vitest';
import { he } from '../../../i18n/he';
import {
  checkSettings,
  expiryExample,
  settingsFormFrom,
  type SettingsFormValues,
} from './settings-form';

const texts = he.newRound.settings;

const SETTINGS = {
  reminderIntervalDays: 3,
  maxReminders: null,
  linkExpiryDays: 60,
  senderName: 'מערכת חתימות',
  hrContact: { name: 'משאבי אנוש', phone: '02-1234567', email: null },
  reminderSkipDates: [],
  employerSignature: null,
};

const valid: SettingsFormValues = {
  remindersEnabled: true,
  reminderIntervalDays: '3',
  limitReminders: false,
  maxReminders: '',
  linkExpiryDays: '60',
};

describe('settingsFormFrom', () => {
  it('fills the form from the settings, reminders on, no limit when max is null', () => {
    expect(settingsFormFrom(SETTINGS)).toEqual(valid);
    expect(settingsFormFrom({ ...SETTINGS, maxReminders: 4 })).toMatchObject({
      limitReminders: true,
      maxReminders: '4',
    });
  });
});

describe('checkSettings', () => {
  it('always gives all four values', () => {
    expect(checkSettings(valid)).toEqual({
      input: {
        remindersEnabled: true,
        reminderIntervalDays: 3,
        maxReminders: null,
        linkExpiryDays: 60,
      },
      errors: {},
    });
    expect(
      checkSettings({
        ...valid,
        remindersEnabled: false,
        limitReminders: true,
        maxReminders: ' 5 ',
      }).input,
    ).toEqual({
      remindersEnabled: false,
      reminderIntervalDays: 3,
      maxReminders: 5,
      linkExpiryDays: 60,
    });
  });

  it.each([
    ['reminderIntervalDays', '0', texts.between(1, 30)],
    ['reminderIntervalDays', '31', texts.between(1, 30)],
    ['linkExpiryDays', '366', texts.between(1, 365)],
    ['linkExpiryDays', '1.5', texts.wholeNumber],
    ['linkExpiryDays', '-3', texts.wholeNumber],
    ['linkExpiryDays', '', texts.wholeNumber],
    ['reminderIntervalDays', 'abc', texts.wholeNumber],
  ] as const)('%s = %j → %s', (field, text, message) => {
    const result = checkSettings({ ...valid, [field]: text });
    expect(result.input).toBeNull();
    expect(result.errors).toEqual({ [field]: message });
  });

  it('checks the maximum only when a limit is chosen', () => {
    expect(checkSettings({ ...valid, maxReminders: 'x' }).input).not.toBeNull();
    expect(checkSettings({ ...valid, limitReminders: true, maxReminders: '' }).errors).toEqual({
      maxReminders: texts.wholeNumber,
    });
    expect(checkSettings({ ...valid, limitReminders: true, maxReminders: '51' }).errors).toEqual({
      maxReminders: texts.between(1, 50),
    });
  });
});

describe('expiryExample', () => {
  it("is the send's rule (now + days × 24 h) as Israel's day, also near midnight", () => {
    // 23:30 in Israel on 28/10 (UTC+2).
    expect(expiryExample('3', new Date('2026-10-28T21:30:00Z'))).toBe('31/10/2026');
    // 00:30 in Israel on 29/10, still 28/10 in UTC.
    expect(expiryExample('3', new Date('2026-10-28T22:30:00Z'))).toBe('01/11/2026');
  });

  it('is null while the days are not valid', () => {
    for (const text of ['', '0', '366', '2.5', 'abc']) expect(expiryExample(text)).toBeNull();
  });
});
