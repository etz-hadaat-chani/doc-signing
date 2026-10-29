import { errorMessage, SENDER_NAME_MAX_LENGTH } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../api/api-error';
import { he } from '../../i18n/he';
import { storedSettings } from './settings.fixtures';
import {
  checkSettingsPage,
  serverSettingsErrors,
  settingsPageFrom,
  type SettingsPageValues,
} from './settings-page-form';

const text = he.settings;
const start = () => settingsPageFrom(storedSettings);
const check = (patch: Partial<SettingsPageValues>) =>
  checkSettingsPage({ ...start(), ...patch }, storedSettings);

describe('settingsPageFrom', () => {
  it('shows the stored values as text (no limit, an empty email)', () => {
    expect(start()).toEqual({
      reminderIntervalDays: '3',
      limitReminders: false,
      maxReminders: '',
      linkExpiryDays: '60',
      senderName: 'מערכת חתימות',
      hrName: 'משאבי אנוש לדוגמה',
      hrPhone: '02-0000000',
      hrEmail: '',
      reminderSkipDates: ['2026-10-03', '2026-10-10'],
    });
  });
});

describe('checkSettingsPage', () => {
  it('nothing changed (spaces at the ends ignored) → nothing to send', () => {
    expect(check({ senderName: ' מערכת חתימות ' })).toEqual({
      input: null,
      errors: {},
      unchanged: true,
    });
  });

  it('sends only the value that changed', () => {
    expect(check({ reminderIntervalDays: '5' })).toEqual({
      input: { reminderIntervalDays: 5 },
      errors: {},
      unchanged: false,
    });
    expect(check({ senderName: 'שם חדש ' }).input).toEqual({ senderName: 'שם חדש' });
  });

  it('a limit set → maxReminders; back to no limit → null', () => {
    expect(check({ limitReminders: true, maxReminders: '4' }).input).toEqual({ maxReminders: 4 });
    const limited = { ...storedSettings, maxReminders: 4 };
    const values = { ...settingsPageFrom(limited), limitReminders: false };
    expect(checkSettingsPage(values, limited).input).toEqual({ maxReminders: null });
  });

  it('numbers out of range or not whole → Hebrew under the field, nothing sent', () => {
    const result = check({ reminderIntervalDays: '31', linkExpiryDays: '1.5' });
    expect(result.input).toBeNull();
    expect(result.errors).toEqual({
      reminderIntervalDays: he.newRound.settings.between(1, 30),
      linkExpiryDays: he.newRound.settings.wholeNumber,
    });
  });

  it('sender name: required and at most 100 characters', () => {
    expect(check({ senderName: '  ' }).errors).toEqual({ senderName: text.required });
    expect(check({ senderName: 'א'.repeat(SENDER_NAME_MAX_LENGTH + 1) }).errors).toEqual({
      senderName: text.tooLong(SENDER_NAME_MAX_LENGTH),
    });
  });

  it('HR contact: the whole contact is sent; empty phone or email → null; email lowercased', () => {
    expect(check({ hrEmail: ' HR@Example.TEST ' }).input).toEqual({
      hrContact: { name: 'משאבי אנוש לדוגמה', phone: '02-0000000', email: 'hr@example.test' },
    });
    expect(check({ hrPhone: '', hrEmail: 'hr@example.test' }).input).toEqual({
      hrContact: { name: 'משאבי אנוש לדוגמה', phone: null, email: 'hr@example.test' },
    });
  });

  it('HR contact: neither phone nor email → both boxes say so', () => {
    const result = check({ hrPhone: ' ', hrEmail: '' });
    expect(result.input).toBeNull();
    expect(result.errors).toEqual({
      hrPhone: text.hrContact.phoneOrEmail,
      hrEmail: text.hrContact.phoneOrEmail,
    });
  });

  it('HR contact: a bad phone, a bad email, an empty name', () => {
    expect(check({ hrPhone: 'abc' }).errors).toEqual({ hrPhone: text.hrContact.phoneInvalid });
    expect(check({ hrEmail: 'not-an-email' }).errors).toEqual({
      hrEmail: text.hrContact.emailInvalid,
    });
    expect(check({ hrName: '' }).errors).toEqual({ hrName: text.required });
  });

  it('an unchanged HR contact the rules would refuse never blocks another change', () => {
    const old = { ...storedSettings, hrContact: { name: 'x', phone: null, email: null } };
    const values = { ...settingsPageFrom(old), reminderIntervalDays: '4' };
    expect(checkSettingsPage(values, old).input).toEqual({ reminderIntervalDays: 4 });
  });

  it('dates: the whole list is sent when it changed (also an emptied list)', () => {
    expect(check({ reminderSkipDates: ['2026-10-03'] }).input).toEqual({
      reminderSkipDates: ['2026-10-03'],
    });
    expect(check({ reminderSkipDates: [] }).input).toEqual({ reminderSkipDates: [] });
  });
});

describe('serverSettingsErrors', () => {
  const refused = (fields: { field: string; code: string }[]) =>
    new ApiRequestError({
      kind: 'api',
      status: 400,
      code: 'VALIDATION_FAILED',
      details: { fields: fields.map((item) => ({ ...item, message: 'x' })) },
    });

  it('maps the API paths to the fields, with our own Hebrew', () => {
    expect(
      serverSettingsErrors(
        refused([
          { field: 'hrContact.phone', code: 'HR_CONTACT_PHONE_OR_EMAIL' },
          { field: 'reminderSkipDates.3', code: 'INVALID_VALUE' },
          { field: 'senderName', code: 'INVALID_VALUE' },
        ]),
      ),
    ).toEqual({
      hrPhone: text.hrContact.phoneOrEmail,
      hrEmail: text.hrContact.phoneOrEmail,
      reminderSkipDates: errorMessage('INVALID_VALUE'),
      senderName: errorMessage('INVALID_VALUE'),
    });
  });

  it('anything else belongs to no field', () => {
    expect(serverSettingsErrors(new Error('x'))).toBeNull();
    expect(
      serverSettingsErrors(
        new ApiRequestError({
          kind: 'api',
          status: 403,
          code: 'FORBIDDEN',
        }),
      ),
    ).toBeNull();
  });
});
