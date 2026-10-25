import { randomUUID } from 'node:crypto';
import {
  EMPLOYER_SIGNATURE_MAX_PIXELS,
  EMPLOYER_SIGNATURE_MIN_PIXELS,
  type EmployerSignatureLink,
  type EmployerSignatureSummary,
  type HrContactSetting,
  type SettingsItem,
  type SettingsUpdateInput,
} from '@doc-signing/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import type { SettingKey } from '../../common/settings/settings.defaults.js';
import {
  EMPLOYER_SIGNATURE_KEY,
  type EmployerSignatureValue,
  HR_CONTACT_KEY,
  REMINDER_SKIP_DATES_KEY,
  type SettingValues,
  SettingsService,
} from '../../common/settings/settings.service.js';
import { MAX_DOWNLOAD_LINK_SECONDS, StorageAdapter } from '../../common/storage/storage.adapter.js';
import { readPngContent } from '../../common/upload/png-content.js';
import { Prisma } from '../../generated/prisma/client.js';

export interface SettingsActor {
  userId: string;
  ip: string | null;
}

/** API field → `settings` key. */
const SETTING_KEYS = {
  reminderIntervalDays: 'reminder_interval_days',
  maxReminders: 'max_reminders',
  linkExpiryDays: 'link_expiry_days',
  senderName: 'sender_name',
} as const satisfies Record<keyof SettingValues, SettingKey>;

/**
 * Key of the transaction-level advisory lock taken by every settings change, so two managers
 * saving at once log the right "old" values. Any fixed number works; used for nothing else.
 */
const SETTINGS_LOCK = 3_018_001;

const PNG_CONTENT_TYPE = 'image/png';
/** The name the browser shows for the image (the storage key has no name). */
const EMPLOYER_SIGNATURE_FILE_NAME = 'חתימת המעסיק.png';
/** `settings/employer-signature/<uuid>.png` → the uuid. */
const FILE_ID = /([0-9a-f-]{36})\.png$/;

function fileIdOf(fileKey: string): string {
  return FILE_ID.exec(fileKey)?.[1] ?? '';
}

function summaryOf(value: EmployerSignatureValue | null): EmployerSignatureSummary | null {
  if (!value) return null;
  return { uploadedAt: value.uploadedAt, width: value.width, height: value.height };
}

const show = (value: string | number | null) => (value === null ? 'null' : String(value));

/** "hrContact.phone: old → new" for each changed part (the organisation's details, 3.13). */
function hrContactChanges(before: HrContactSetting, after: HrContactSetting): string[] {
  const parts = ['name', 'phone', 'email'] as const;
  return parts
    .filter((part) => before[part] !== after[part])
    .map((part) => `hrContact.${part}: ${show(before[part])} → ${show(after[part])}`);
}

/** The no-reminder dates in an audit line: dates only, no personal data. */
const showDays = (days: readonly string[]) => (days.length === 0 ? '[]' : days.join(', '));

/**
 * Settings a manager changes (FR-ADM-2): the four defaults and the employer signature and stamp
 * image (FR-TPL-7). Reading for other modules is `SettingsService`.
 */
@Injectable()
export class SettingsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly storage: StorageAdapter,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<SettingsItem> {
    const [values, hrContact, reminderSkipDates, image] = await Promise.all([
      this.settings.getAll(),
      this.settings.getHrContact(),
      this.settings.getReminderSkipDates(),
      this.settings.getEmployerSignature(),
    ]);
    return { ...values, hrContact, reminderSkipDates, employerSignature: summaryOf(image) };
  }

  /**
   * Saves the values that differ from the stored (or default) ones, with one audit row of
   * "field: old → new". Nothing different → nothing written, no audit row.
   */
  async update(input: SettingsUpdateInput, actor: SettingsActor): Promise<SettingsItem> {
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx);
      const before = await this.settings.getAll(tx);
      const changes: string[] = [];
      for (const field of Object.keys(SETTING_KEYS) as (keyof SettingValues)[]) {
        const value = input[field];
        if (value === undefined || value === before[field]) continue;
        await this.write(SETTING_KEYS[field], value, actor.userId, tx);
        changes.push(`${field}: ${show(before[field])} → ${show(value)}`);
      }
      if (input.hrContact) {
        const contactChanges = hrContactChanges(
          await this.settings.getHrContact(tx),
          input.hrContact,
        );
        if (contactChanges.length > 0) {
          await this.write(HR_CONTACT_KEY, input.hrContact, actor.userId, tx);
          changes.push(...contactChanges);
        }
      }
      if (input.reminderSkipDates) {
        const before = await this.settings.getReminderSkipDates(tx);
        const after = input.reminderSkipDates;
        if (before.join() !== after.join()) {
          await this.write(REMINDER_SKIP_DATES_KEY, after, actor.userId, tx);
          changes.push(`reminderSkipDates: ${showDays(before)} → ${showDays(after)}`);
        }
      }
      if (changes.length === 0) return;
      await this.audit.record(
        {
          actor: { type: 'user', userId: actor.userId },
          action: 'settings.updated',
          entity: { type: 'settings', id: null },
          ip: actor.ip,
          details: { changes },
        },
        tx,
      );
    });
    return this.get();
  }

  /**
   * Checks the PNG by its content, saves it under a new key (`settings/employer-signature/
   * <uuid>.png`; never overwrites) and points the `employer_signature` setting to it. The old
   * file stays in storage: assignments already sent keep the key saved with them (FR-RND-8).
   */
  async uploadEmployerSignature(
    bytes: Buffer,
    actor: SettingsActor,
  ): Promise<EmployerSignatureSummary> {
    const content = await readPngContent(bytes, {
      minPixels: EMPLOYER_SIGNATURE_MIN_PIXELS,
      maxPixels: EMPLOYER_SIGNATURE_MAX_PIXELS,
    });
    if (!content.ok) {
      const code = content.problem === 'dimensions' ? 'PNG_DIMENSIONS_INVALID' : 'INVALID_PNG_FILE';
      throw new AppException(code, HttpStatus.BAD_REQUEST);
    }
    const fileId = randomUUID();
    const fileKey = `settings/employer-signature/${fileId}.png`;
    // The file first: the setting must never point to a missing file. A failed save after it
    // leaves an unused file, never a wrong one.
    const stored = await this.storage.upload(fileKey, bytes, { contentType: PNG_CONTENT_TYPE });
    const value: EmployerSignatureValue = {
      fileKey,
      uploadedAt: new Date().toISOString(),
      width: content.width,
      height: content.height,
      sha256: stored.sha256,
    };
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx);
      const previous = await this.settings.getEmployerSignature(tx);
      await this.write(EMPLOYER_SIGNATURE_KEY, value, actor.userId, tx);
      await this.audit.record(
        {
          actor: { type: 'user', userId: actor.userId },
          action: 'settings.employer_signature_uploaded',
          entity: { type: 'settings', id: null },
          ip: actor.ip,
          details: {
            fileId,
            width: value.width,
            height: value.height,
            size: stored.size,
            fileSha256: value.sha256,
            replacedFileId: previous ? fileIdOf(previous.fileKey) : null,
          },
        },
        tx,
      );
    });
    return { uploadedAt: value.uploadedAt, width: value.width, height: value.height };
  }

  /** A link to the current image that expires within minutes (NFR-SEC-8); logged. 404 if none. */
  async employerSignatureLink(actor: SettingsActor): Promise<EmployerSignatureLink> {
    const image = await this.settings.getEmployerSignature();
    if (!image) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    const expiresAt = new Date(Date.now() + MAX_DOWNLOAD_LINK_SECONDS * 1000).toISOString();
    const url = await this.storage.createDownloadLink(image.fileKey, {
      fileName: EMPLOYER_SIGNATURE_FILE_NAME,
      disposition: 'inline',
      expiresInSeconds: MAX_DOWNLOAD_LINK_SECONDS,
    });
    await this.audit.record({
      actor: { type: 'user', userId: actor.userId },
      action: 'settings.employer_signature_viewed',
      entity: { type: 'settings', id: null },
      ip: actor.ip,
      details: { fileId: fileIdOf(image.fileKey) },
    });
    return {
      url,
      expiresAt,
      uploadedAt: image.uploadedAt,
      width: image.width,
      height: image.height,
    };
  }

  private async lock(db: Db): Promise<void> {
    await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${SETTINGS_LOCK}::bigint)`;
  }

  private async write(key: string, value: unknown, userId: string, db: Db): Promise<void> {
    const json = value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
    await db.setting.upsert({
      where: { key },
      create: { key, value: json, updatedById: userId },
      update: { value: json, updatedById: userId },
    });
  }
}
