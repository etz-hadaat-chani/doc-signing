import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { SETTING_DEFAULTS } from './settings.defaults.js';
import { SettingsService } from './settings.service.js';

/** A fake client whose `settings` table holds these rows (key → value). */
function serviceWithRows(rows: Record<string, unknown>): SettingsService {
  const list = Object.entries(rows).map(([key, value]) => ({ key, value }));
  const prisma = {
    setting: {
      findUnique: ({ where }: { where: { key: string } }) =>
        Promise.resolve(list.find(({ key }) => key === where.key) ?? null),
      findMany: ({ where }: { where: { key: { in: string[] } } }) =>
        Promise.resolve(list.filter(({ key }) => where.key.in.includes(key))),
    },
  };
  return new SettingsService(prisma as unknown as PrismaService);
}

/** Only a `sender_name` row with this value (undefined = no row). */
const serviceWith = (value: unknown) =>
  serviceWithRows(value === undefined ? {} : { sender_name: value });

describe('SettingsService.getSenderName', () => {
  it('reads the stored sender name', async () => {
    expect(await serviceWith('  משאבי אנוש  ').getSenderName()).toBe('משאבי אנוש');
  });

  it.each([
    ['no row', undefined],
    ['null', null],
    ['a number', 5],
    ['an empty string', '   '],
    ['two lines', 'שם\r\nBcc: x@example.com'],
    ['a too-long name', 'א'.repeat(101)],
  ])('falls back to the default for %s', async (_label, value) => {
    expect(await serviceWith(value).getSenderName()).toBe(SETTING_DEFAULTS.sender_name);
  });
});

describe('SettingsService.getAll', () => {
  it('gives the built-in defaults when nothing is stored', async () => {
    expect(await serviceWithRows({}).getAll()).toEqual({
      reminderIntervalDays: 3,
      maxReminders: null,
      linkExpiryDays: 60,
      senderName: 'מערכת חתימות',
    });
  });

  it('reads stored values', async () => {
    const service = serviceWithRows({
      reminder_interval_days: 5,
      max_reminders: 4,
      link_expiry_days: 30,
      sender_name: 'משאבי אנוש',
    });
    expect(await service.getAll()).toEqual({
      reminderIntervalDays: 5,
      maxReminders: 4,
      linkExpiryDays: 30,
      senderName: 'משאבי אנוש',
    });
  });

  it('falls back to the default for each broken value on its own', async () => {
    const service = serviceWithRows({
      reminder_interval_days: 0,
      max_reminders: 'many',
      link_expiry_days: 30,
    });
    expect(await service.getAll()).toEqual({
      reminderIntervalDays: 3,
      maxReminders: null,
      linkExpiryDays: 30,
      senderName: 'מערכת חתימות',
    });
  });
});

describe('SettingsService.getRoundDefaults', () => {
  it('gives what a new round copies (3.9)', async () => {
    expect(await serviceWithRows({ link_expiry_days: 90 }).getRoundDefaults()).toEqual({
      reminderIntervalDays: 3,
      maxReminders: null,
      linkExpiryDays: 90,
    });
  });
});

describe('SettingsService.getEmployerSignature', () => {
  const stored = {
    fileKey: 'settings/employer-signature/0b6f3c2e-2c4d-4e55-9a51-0e5c8b8f6f10.png',
    uploadedAt: '2026-10-17T09:00:00.000Z',
    width: 1200,
    height: 500,
    sha256: 'a'.repeat(64),
  };

  it('is null when no image was uploaded', async () => {
    const service = serviceWithRows({});
    expect(await service.getEmployerSignature()).toBeNull();
    expect(await service.hasEmployerSignatureImage()).toBe(false);
  });

  it('reads the stored image', async () => {
    const service = serviceWithRows({ employer_signature: stored });
    expect(await service.getEmployerSignature()).toEqual(stored);
    expect(await service.hasEmployerSignatureImage()).toBe(true);
  });

  it('treats a broken value as no image', async () => {
    const service = serviceWithRows({ employer_signature: { fileKey: stored.fileKey } });
    expect(await service.hasEmployerSignatureImage()).toBe(false);
  });
});
