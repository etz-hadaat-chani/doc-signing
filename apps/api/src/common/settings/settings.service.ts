import {
  type HrContactSetting,
  hrContactSchema,
  linkExpiryDaysSchema,
  maxRemindersSchema,
  reminderIntervalDaysSchema,
  reminderSkipDatesSchema,
  senderNameSchema,
} from '@doc-signing/shared';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppConfig } from '../config/config.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Db } from '../prisma/prisma.types.js';
import { SETTING_DEFAULTS, type SettingKey } from './settings.defaults.js';

/** The `settings` key of the employer signature and stamp image (FR-ADM-2). */
export const EMPLOYER_SIGNATURE_KEY = 'employer_signature';
/** The `settings` key of the HR contact (3.13): signing pages and email footers. */
export const HR_CONTACT_KEY = 'hr_contact';
/** The `settings` key of the no-reminder dates (3.14); none stored = no such date. */
export const REMINDER_SKIP_DATES_KEY = 'reminder_skip_dates';

/** The four default values, by their API names. */
export interface SettingValues {
  reminderIntervalDays: number;
  /** null = no limit. */
  maxReminders: number | null;
  linkExpiryDays: number;
  senderName: string;
}

/** What a new round copies (3.9): `link_expires_at` = creation time + `linkExpiryDays`. */
export type RoundDefaults = Pick<
  SettingValues,
  'reminderIntervalDays' | 'maxReminders' | 'linkExpiryDays'
>;

/** The stored `employer_signature` value. Each upload has its own key; files are never deleted. */
export const employerSignatureValueSchema = z.object({
  fileKey: z.string().min(1),
  uploadedAt: z.iso.datetime(),
  width: z.int().positive(),
  height: z.int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type EmployerSignatureValue = z.infer<typeof employerSignatureValueSchema>;

/**
 * Reads settings. A missing row, or a stored value that breaks its rule, gives the built-in
 * default (`SETTING_DEFAULTS`; the seed doesn't run in production). Changing them is
 * `SettingsAdminService` (modules/settings).
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /** The four default values. */
  async getAll(db: Db = this.prisma): Promise<SettingValues> {
    const keys = Object.keys(SETTING_DEFAULTS) as SettingKey[];
    const rows = await db.setting.findMany({ where: { key: { in: keys } } });
    const stored = new Map(rows.map(({ key, value }) => [key, value]));
    // Each stored value is read back with its shared rule.
    const read = <T>(key: SettingKey, schema: z.ZodType<T>, fallback: T): T => {
      const parsed = schema.safeParse(stored.get(key));
      return parsed.success ? parsed.data : fallback;
    };
    return {
      reminderIntervalDays: read(
        'reminder_interval_days',
        reminderIntervalDaysSchema,
        SETTING_DEFAULTS.reminder_interval_days,
      ),
      maxReminders: read('max_reminders', maxRemindersSchema, SETTING_DEFAULTS.max_reminders),
      linkExpiryDays: read(
        'link_expiry_days',
        linkExpiryDaysSchema,
        SETTING_DEFAULTS.link_expiry_days,
      ),
      senderName: read('sender_name', senderNameSchema, SETTING_DEFAULTS.sender_name),
    };
  }

  /** The values a new round starts with (3.9). */
  async getRoundDefaults(db: Db = this.prisma): Promise<RoundDefaults> {
    const { reminderIntervalDays, maxReminders, linkExpiryDays } = await this.getAll(db);
    return { reminderIntervalDays, maxReminders, linkExpiryDays };
  }

  /** The From display name of every email. A missing or bad value gives the built-in default. */
  async getSenderName(db: Db = this.prisma): Promise<string> {
    const row = await db.setting.findUnique({ where: { key: 'sender_name' } });
    const parsed = senderNameSchema.safeParse(row?.value);
    return parsed.success ? parsed.data : SETTING_DEFAULTS.sender_name;
  }

  /**
   * Who employees contact (FR-SGN-7, email footers). A missing or bad row gives the built-in
   * default: the `HR_CONTACT_*` environment values, so a new install always has one.
   */
  async getHrContact(db: Db = this.prisma): Promise<HrContactSetting> {
    const row = await db.setting.findUnique({ where: { key: HR_CONTACT_KEY } });
    const parsed = hrContactSchema.safeParse(row?.value);
    if (parsed.success) return parsed.data;
    const { name, phone, email } = this.config.email.hrContact;
    return { name, phone: phone ?? null, email: email ?? null };
  }

  /**
   * Days in Israel (`YYYY-MM-DD`, sorted) on which the daily reminder job sends nothing (3.14). A
   * missing or bad row gives the built-in default: no such day.
   */
  async getReminderSkipDates(db: Db = this.prisma): Promise<string[]> {
    const row = await db.setting.findUnique({ where: { key: REMINDER_SKIP_DATES_KEY } });
    const parsed = reminderSkipDatesSchema.safeParse(row?.value);
    return parsed.success ? parsed.data : [];
  }

  /**
   * The current employer signature image, or null when none was uploaded (or the stored value
   * is broken). The send (3.10) saves its `fileKey` with each assignment, so a later
   * replacement never changes a document already sent.
   */
  async getEmployerSignature(db: Db = this.prisma): Promise<EmployerSignatureValue | null> {
    const row = await db.setting.findUnique({ where: { key: EMPLOYER_SIGNATURE_KEY } });
    const parsed = employerSignatureValueSchema.safeParse(row?.value);
    return parsed.success ? parsed.data : null;
  }

  /** For the "template ready" check: `pre_signed` / `after_employee` need the image. */
  async hasEmployerSignatureImage(db: Db = this.prisma): Promise<boolean> {
    return (await this.getEmployerSignature(db)) !== null;
  }
}
