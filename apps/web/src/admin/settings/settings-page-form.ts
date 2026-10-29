import {
  errorMessage,
  fieldErrorSchema,
  HR_CONTACT_NAME_MAX_LENGTH,
  hrContactSchema,
  reminderSkipDatesSchema,
  SENDER_NAME_MAX_LENGTH,
  senderNameSchema,
  type SettingsItem,
  type SettingsUpdateInput,
} from '@doc-signing/shared';
import { z } from 'zod';
import { isApiRequestError } from '../../api/api-error';
import { he } from '../../i18n/he';
import { checkSettings, settingsFormFrom } from '../rounds/new/settings-form';

/**
 * The settings form (A11, FR-ADM-2) as typed text, and the way to `PATCH /api/settings`. Only
 * the parts that changed are checked and sent (the `employee-form.ts` pattern), so an old stored
 * value that a newer rule would refuse never blocks saving something else, and the audit row
 * names only what the manager changed.
 */

export interface SettingsPageValues {
  reminderIntervalDays: string;
  /** False = no limit (`maxReminders` null). */
  limitReminders: boolean;
  maxReminders: string;
  linkExpiryDays: string;
  senderName: string;
  hrName: string;
  hrPhone: string;
  hrEmail: string;
  /** `YYYY-MM-DD`, sorted (the dates editor keeps it so). */
  reminderSkipDates: string[];
}

export const SETTINGS_PAGE_FIELDS = [
  'reminderIntervalDays',
  'maxReminders',
  'linkExpiryDays',
  'senderName',
  'hrName',
  'hrPhone',
  'hrEmail',
  'reminderSkipDates',
] as const;
export type SettingsPageField = (typeof SETTINGS_PAGE_FIELDS)[number];
export type SettingsPageErrors = Partial<Record<SettingsPageField, string>>;

const text = he.settings;

export function settingsPageFrom(item: SettingsItem): SettingsPageValues {
  const numbers = settingsFormFrom(item);
  return {
    reminderIntervalDays: numbers.reminderIntervalDays,
    limitReminders: numbers.limitReminders,
    maxReminders: numbers.maxReminders,
    linkExpiryDays: numbers.linkExpiryDays,
    senderName: item.senderName,
    hrName: item.hrContact.name,
    hrPhone: item.hrContact.phone ?? '',
    hrEmail: item.hrContact.email ?? '',
    reminderSkipDates: [...item.reminderSkipDates].sort(),
  };
}

const optional = (value: string) => (value.trim() === '' ? null : value);

/** Which parts differ from the stored settings (typed text compared, spaces at the ends ignored). */
function changedParts(values: SettingsPageValues, before: SettingsPageValues) {
  const differs = (field: keyof SettingsPageValues) => {
    const now = values[field];
    const then = before[field];
    if (typeof now === 'string' && typeof then === 'string') return now.trim() !== then.trim();
    return JSON.stringify(now) !== JSON.stringify(then);
  };
  return {
    reminderIntervalDays: differs('reminderIntervalDays'),
    // "No limit" ↔ a number, or a different number while limited.
    maxReminders: differs('limitReminders') || (values.limitReminders && differs('maxReminders')),
    linkExpiryDays: differs('linkExpiryDays'),
    senderName: differs('senderName'),
    hrContact: differs('hrName') || differs('hrPhone') || differs('hrEmail'),
    reminderSkipDates: differs('reminderSkipDates'),
  };
}

/** A one-line name's problem: empty, too long, or anything else. */
function nameError(issue: z.core.$ZodIssue | undefined, max: number): string {
  if (issue?.code === 'too_big') return text.tooLong(max);
  if (issue?.code === 'too_small') return text.required;
  return errorMessage('INVALID_VALUE');
}

/** HR contact problems by field; "phone or email" marks both boxes. */
function hrContactErrors(issues: readonly z.core.$ZodIssue[]): SettingsPageErrors {
  const errors: SettingsPageErrors = {};
  for (const issue of issues) {
    if (issue.message === 'HR_CONTACT_PHONE_OR_EMAIL') {
      errors.hrPhone ??= text.hrContact.phoneOrEmail;
      errors.hrEmail ??= text.hrContact.phoneOrEmail;
      continue;
    }
    const part = issue.path[0];
    if (part === 'name') errors.hrName ??= nameError(issue, HR_CONTACT_NAME_MAX_LENGTH);
    if (part === 'phone') errors.hrPhone ??= text.hrContact.phoneInvalid;
    if (part === 'email') errors.hrEmail ??= text.hrContact.emailInvalid;
  }
  return errors;
}

/**
 * Checks the changed parts with the shared rules. `unchanged` = nothing to send; `input` is null
 * while any changed part has a problem (Hebrew, by field). The HR contact and the dates are
 * whole values: when any part of them changed, all of it is sent.
 */
export function checkSettingsPage(
  values: SettingsPageValues,
  stored: SettingsItem,
): { input: SettingsUpdateInput | null; errors: SettingsPageErrors; unchanged: boolean } {
  const changed = changedParts(values, settingsPageFrom(stored));
  if (!Object.values(changed).some(Boolean)) return { input: null, errors: {}, unchanged: true };

  const errors: SettingsPageErrors = {};
  const input: SettingsUpdateInput = {};

  if (changed.reminderIntervalDays || changed.maxReminders || changed.linkExpiryDays) {
    const numbers = checkSettings({ ...values, remindersEnabled: true });
    for (const field of ['reminderIntervalDays', 'maxReminders', 'linkExpiryDays'] as const) {
      if (changed[field] && numbers.errors[field]) errors[field] = numbers.errors[field];
    }
    if (numbers.input) {
      if (changed.reminderIntervalDays)
        input.reminderIntervalDays = numbers.input.reminderIntervalDays;
      if (changed.maxReminders) input.maxReminders = numbers.input.maxReminders;
      if (changed.linkExpiryDays) input.linkExpiryDays = numbers.input.linkExpiryDays;
    }
  }

  if (changed.senderName) {
    const result = senderNameSchema.safeParse(values.senderName);
    if (result.success) input.senderName = result.data;
    else errors.senderName = nameError(result.error.issues[0], SENDER_NAME_MAX_LENGTH);
  }

  if (changed.hrContact) {
    const result = hrContactSchema.safeParse({
      name: values.hrName,
      phone: optional(values.hrPhone),
      email: optional(values.hrEmail),
    });
    if (result.success) input.hrContact = result.data;
    else Object.assign(errors, hrContactErrors(result.error.issues));
  }

  if (changed.reminderSkipDates) {
    const result = reminderSkipDatesSchema.safeParse(values.reminderSkipDates);
    if (result.success) input.reminderSkipDates = result.data;
    else errors.reminderSkipDates = text.skipDates.listInvalid;
  }

  const ok = Object.keys(errors).length === 0;
  return { input: ok ? input : null, errors, unchanged: false };
}

/** The API's field path → the form field (`hrContact.phone` → `hrPhone`, a date → the list). */
function fieldOf(path: string): SettingsPageField | null {
  const [head, part] = path.split('.');
  if (head === 'hrContact') {
    if (part === 'name') return 'hrName';
    if (part === 'email') return 'hrEmail';
    return 'hrPhone';
  }
  return SETTINGS_PAGE_FIELDS.find((field) => field === head) ?? null;
}

/**
 * A refused save → the fields to mark, each with our own Hebrew text for the code (never text
 * from the response). Null when the error belongs to no field (shown as a notification).
 */
export function serverSettingsErrors(error: unknown): SettingsPageErrors | null {
  if (!isApiRequestError(error) || error.code !== 'VALIDATION_FAILED') return null;
  const parsed = z.array(fieldErrorSchema).safeParse(error.details?.fields);
  if (!parsed.success) return null;
  const errors: SettingsPageErrors = {};
  for (const item of parsed.data) {
    const field = fieldOf(item.field);
    if (field === null || errors[field] !== undefined) continue;
    errors[field] =
      item.code === 'HR_CONTACT_PHONE_OR_EMAIL'
        ? text.hrContact.phoneOrEmail
        : errorMessage(item.code);
  }
  if (errors.hrPhone === text.hrContact.phoneOrEmail) errors.hrEmail ??= errors.hrPhone;
  return Object.keys(errors).length === 0 ? null : errors;
}
