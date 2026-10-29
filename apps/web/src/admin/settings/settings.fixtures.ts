import type { EmployerSignatureLink, SettingsItem } from '@doc-signing/shared';

/** Made-up settings as `GET /api/settings` returns them. */
export const storedSettings: SettingsItem = {
  reminderIntervalDays: 3,
  maxReminders: null,
  linkExpiryDays: 60,
  senderName: 'מערכת חתימות',
  hrContact: { name: 'משאבי אנוש לדוגמה', phone: '02-0000000', email: null },
  reminderSkipDates: ['2026-10-03', '2026-10-10'],
  employerSignature: { uploadedAt: '2026-10-20T07:30:00.000Z', width: 600, height: 300 },
};

export const signatureLink: EmployerSignatureLink = {
  url: 'http://localhost:9000/files/settings-image?sig=abc',
  expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  uploadedAt: '2026-10-20T07:30:00.000Z',
  width: 600,
  height: 300,
};
