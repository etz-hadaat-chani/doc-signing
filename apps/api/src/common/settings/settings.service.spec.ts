import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { SETTING_DEFAULTS } from './settings.defaults.js';
import { SettingsService } from './settings.service.js';

/** A fake client whose `settings` table holds only the given value (undefined = no row). */
function serviceWith(value: unknown): SettingsService {
  const prisma = {
    setting: {
      findUnique: () => Promise.resolve(value === undefined ? null : { key: 'sender_name', value }),
    },
  };
  return new SettingsService(prisma as unknown as PrismaService);
}

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
