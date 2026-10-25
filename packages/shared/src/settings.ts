import { z } from 'zod';

/**
 * Default settings a manager can change (FR-ADM-2, PRD §12 `settings`). One rule per value, used
 * by `PATCH /api/settings`, by the API when it reads a stored value back, and by the settings form.
 */

/** Days between reminders: 1 to 30. */
export const REMINDER_INTERVAL_DAYS_MAX = 30;
/** A limit on reminders, when one is set: 1 to 50. `null` = no limit. */
export const MAX_REMINDERS_MAX = 50;
/** Days a link stays valid: 1 to 365. */
export const LINK_EXPIRY_DAYS_MAX = 365;
/** `sender_name` is the From display name of every email: one line, at most 100 characters. */
export const SENDER_NAME_MAX_LENGTH = 100;

export const reminderIntervalDaysSchema = z.int().min(1).max(REMINDER_INTERVAL_DAYS_MAX);
export const maxRemindersSchema = z.int().min(1).max(MAX_REMINDERS_MAX).nullable();
export const linkExpiryDaysSchema = z.int().min(1).max(LINK_EXPIRY_DAYS_MAX);
/** A display name for the From header: one line, not empty after trimming. */
export const senderNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(SENDER_NAME_MAX_LENGTH)
  .regex(/^[^\r\n]*$/);

/** At most this many no-reminder dates. */
export const REMINDER_SKIP_DATES_MAX = 100;

/** `YYYY-MM-DD` that is a real calendar day (no 2026-02-30). */
function isCalendarDay(value: string): boolean {
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

/**
 * `reminder_skip_dates` (3.14): days in Israel (`YYYY-MM-DD`) on which the daily reminder job
 * sends nothing, such as Yom Tov. Real dates, no duplicates, at most 100; read back sorted.
 * Manual reminders ignore it.
 */
export const reminderSkipDatesSchema = z
  .array(
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(isCalendarDay),
  )
  .max(REMINDER_SKIP_DATES_MAX)
  .refine((days) => new Set(days).size === days.length, { message: 'DUPLICATE_DATE' })
  .transform((days) => [...days].sort());

/** HR contact name: one line, at most 100 characters. */
export const HR_CONTACT_NAME_MAX_LENGTH = 100;
/** A phone as people write it: digits, spaces, `+`, `-`, brackets; 6 to 20 characters. */
export const HR_CONTACT_PHONE_PATTERN = /^[0-9+\-\s()]{6,20}$/;

/**
 * `hr_contact`: who employees call or write to, on the signing pages (FR-SGN-7, B5) and in every
 * email's footer. The organisation's details, not an employee's. Phone, email or both; `null` =
 * not shown.
 */
export const hrContactSchema = z
  .strictObject({
    name: z
      .string()
      .trim()
      .min(1)
      .max(HR_CONTACT_NAME_MAX_LENGTH)
      .regex(/^[^\r\n]*$/),
    phone: z.string().trim().regex(HR_CONTACT_PHONE_PATTERN).nullable(),
    email: z.string().trim().toLowerCase().max(254).pipe(z.email()).nullable(),
  })
  .refine(({ phone, email }) => phone !== null || email !== null, {
    message: 'HR_CONTACT_PHONE_OR_EMAIL',
    path: ['phone'],
  });
export type HrContactSetting = z.infer<typeof hrContactSchema>;

/** `PATCH /api/settings`: any of the values, at least one; unknown fields are refused. */
export const settingsUpdateSchema = z
  .strictObject({
    reminderIntervalDays: reminderIntervalDaysSchema.optional(),
    maxReminders: maxRemindersSchema.optional(),
    linkExpiryDays: linkExpiryDaysSchema.optional(),
    senderName: senderNameSchema.optional(),
    hrContact: hrContactSchema.optional(),
    reminderSkipDates: reminderSkipDatesSchema.optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined));
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;

// ---------------------------------------------------------------------------
// Employer signature and stamp image (FR-ADM-2, FR-TPL-7, NFR-SEC-9)
// ---------------------------------------------------------------------------

/** Upload cap for the employer signature image: 1 MB. */
export const EMPLOYER_SIGNATURE_MAX_BYTES = 1024 * 1024;
/** Each side of the image, in pixels: at least 100 (sharp enough to print), at most 3000. */
export const EMPLOYER_SIGNATURE_MIN_PIXELS = 100;
export const EMPLOYER_SIGNATURE_MAX_PIXELS = 3000;

/** The current image, as the settings screen shows it. Never the storage key. */
export const employerSignatureSummarySchema = z.object({
  uploadedAt: z.iso.datetime(),
  width: z.int(),
  height: z.int(),
});
export type EmployerSignatureSummary = z.infer<typeof employerSignatureSummarySchema>;

/** `GET /api/settings`. */
export const settingsItemSchema = z.object({
  reminderIntervalDays: z.int(),
  maxReminders: z.int().nullable(),
  linkExpiryDays: z.int(),
  senderName: z.string(),
  hrContact: z.object({
    name: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
  }),
  /** No-reminder dates, `YYYY-MM-DD`, sorted. */
  reminderSkipDates: z.array(z.string()),
  /** null until the manager uploads the image. */
  employerSignature: employerSignatureSummarySchema.nullable(),
});
export type SettingsItem = z.infer<typeof settingsItemSchema>;

/** `GET /api/settings/employer-signature`: a short-lived link to the current image. */
export const employerSignatureLinkSchema = employerSignatureSummarySchema.extend({
  url: z.string(),
  expiresAt: z.iso.datetime(),
});
export type EmployerSignatureLink = z.infer<typeof employerSignatureLinkSchema>;
