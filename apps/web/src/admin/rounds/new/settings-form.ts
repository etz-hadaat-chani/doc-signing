import {
  formatDate,
  LINK_EXPIRY_DAYS_MAX,
  linkExpiresAtFrom,
  MAX_REMINDERS_MAX,
  REMINDER_INTERVAL_DAYS_MAX,
  roundSettingsInputSchema,
  type SettingsItem,
} from '@doc-signing/shared';
import { he } from '../../../i18n/he';

const texts = he.newRound.settings;

/**
 * The round's settings (FR-RND-5) as the form holds them: typed text, checked with the shared
 * schema (the server's rule). All four values are always sent, so what the manager sees is what
 * the round gets, even if the defaults change meanwhile.
 */
export interface SettingsFormValues {
  remindersEnabled: boolean;
  reminderIntervalDays: string;
  /** False = no limit (`maxReminders` null). */
  limitReminders: boolean;
  maxReminders: string;
  linkExpiryDays: string;
}

export const SETTINGS_FIELDS = ['reminderIntervalDays', 'maxReminders', 'linkExpiryDays'] as const;
export type SettingsField = (typeof SETTINGS_FIELDS)[number];
export type SettingsErrors = Partial<Record<SettingsField, string>>;

/** What `POST /api/rounds` gets in `settings`: every value, none left to the defaults. */
export interface RoundSettings {
  remindersEnabled: boolean;
  reminderIntervalDays: number;
  maxReminders: number | null;
  linkExpiryDays: number;
}

/** The form filled from `GET /api/settings`; automatic reminders on (the round default). */
export function settingsFormFrom(item: SettingsItem): SettingsFormValues {
  return {
    remindersEnabled: true,
    reminderIntervalDays: String(item.reminderIntervalDays),
    limitReminders: item.maxReminders !== null,
    maxReminders: item.maxReminders === null ? '' : String(item.maxReminders),
    linkExpiryDays: String(item.linkExpiryDays),
  };
}

const MAXIMUM: Record<SettingsField, number> = {
  reminderIntervalDays: REMINDER_INTERVAL_DAYS_MAX,
  maxReminders: MAX_REMINDERS_MAX,
  linkExpiryDays: LINK_EXPIRY_DAYS_MAX,
};

/** "12" → 12; anything but digits (a sign, a dot, a letter, nothing) → null. */
function wholeNumber(text: string): number | null {
  const trimmed = text.trim();
  return /^\d{1,6}$/.test(trimmed) ? Number(trimmed) : null;
}

/** Checks the form; `input` is null while any field has a problem (Hebrew, by field). */
export function checkSettings(values: SettingsFormValues): {
  input: RoundSettings | null;
  errors: SettingsErrors;
} {
  const errors: SettingsErrors = {};
  const read = (field: SettingsField): number => {
    const value = wholeNumber(values[field]);
    if (value === null) errors[field] = texts.wholeNumber;
    return value ?? 0;
  };
  const candidate: RoundSettings = {
    remindersEnabled: values.remindersEnabled,
    reminderIntervalDays: read('reminderIntervalDays'),
    maxReminders: values.limitReminders ? read('maxReminders') : null,
    linkExpiryDays: read('linkExpiryDays'),
  };
  const result = roundSettingsInputSchema.safeParse(candidate);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = SETTINGS_FIELDS.find((name) => name === issue.path[0]);
      if (field && errors[field] === undefined) errors[field] = texts.between(1, MAXIMUM[field]);
    }
  }
  return { input: Object.keys(errors).length === 0 ? candidate : null, errors };
}

/**
 * "If sent today: valid until DD/MM/YYYY": the send's own rule (now + days × 24 h) in Israel's
 * day. Null while the days aren't a valid number.
 */
export function expiryExample(linkExpiryDays: string, now: Date = new Date()): string | null {
  const days = wholeNumber(linkExpiryDays);
  if (days === null || days < 1 || days > LINK_EXPIRY_DAYS_MAX) return null;
  return formatDate(linkExpiresAtFrom(now, days));
}
