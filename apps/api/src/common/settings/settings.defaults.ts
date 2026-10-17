/**
 * Built-in settings used when a `settings` row is missing (the seed doesn't run in production).
 * The seed writes these same values (FR-ADM-2); a manager changes them with PATCH /api/settings.
 */
export const SETTING_DEFAULTS = {
  reminder_interval_days: 3,
  /** null = no limit. */
  max_reminders: null,
  link_expiry_days: 60,
  sender_name: 'מערכת חתימות',
} as const satisfies Record<string, number | string | null>;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
