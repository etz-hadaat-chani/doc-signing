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

/** `PATCH /api/settings`: any of the four values, at least one; unknown fields are refused. */
export const settingsUpdateSchema = z
  .strictObject({
    reminderIntervalDays: reminderIntervalDaysSchema.optional(),
    maxReminders: maxRemindersSchema.optional(),
    linkExpiryDays: linkExpiryDaysSchema.optional(),
    senderName: senderNameSchema.optional(),
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
