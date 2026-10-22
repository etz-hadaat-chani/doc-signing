import {
  type ApiError,
  EMPLOYER_SIGNATURE_MAX_BYTES,
  employerSignatureLinkSchema,
  employerSignatureSummarySchema,
  type SettingsItem,
  settingsItemSchema,
} from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runSeed } from '../../prisma/run-seed.js';
import { AppConfig } from '../../src/common/config/config.schema.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import {
  EMPLOYER_SIGNATURE_KEY,
  employerSignatureValueSchema,
  SettingsService,
} from '../../src/common/settings/settings.service.js';
import { StorageAdapter } from '../../src/common/storage/storage.adapter.js';
import { testJpegBytes, testPng } from '../fixtures/png.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { resetDatabase } from '../setup/database.js';

const seedPassword = 'test-seed-password';
const manager = 'manager@doc-signing.local';
const officer = 'officer@doc-signing.local';

let app: INestApplication;
let prisma: PrismaService;
let managerCookie: string;
let officerCookie: string;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  await resetDatabase(prisma);
  await runSeed(prisma, { password: seedPassword });
  managerCookie = await cookieFor(manager);
  officerCookie = await cookieFor(officer);
});

afterAll(async () => {
  await app.close();
});

async function cookieFor(email: string): Promise<string> {
  const response = await request(httpServer(app))
    .post('/api/auth/login')
    .send({ email, password: seedPassword });
  expect(response.status).toBe(200);
  const lines = response.headers['set-cookie'] as unknown as string[];
  const line = lines.find((value) => value.startsWith('sid=')) ?? '';
  return line.split(';')[0] ?? '';
}

const server = () => request(httpServer(app));
const errorOf = (response: request.Response) => (response.body as ApiError).error;
const itemOf = (response: request.Response): SettingsItem =>
  settingsItemSchema.parse(response.body);

const getSettings = () => server().get('/api/settings').set('Cookie', managerCookie);
const patchSettings = (body: unknown) =>
  server()
    .patch('/api/settings')
    .set('Cookie', managerCookie)
    .send(body as object);
const uploadImage = (bytes: Buffer, fileName = 'חתימה.png') =>
  server()
    .post('/api/settings/employer-signature')
    .set('Cookie', managerCookie)
    .attach('file', bytes, fileName);

async function auditOf(action: string) {
  return prisma.auditLog.findMany({ where: { action }, orderBy: { id: 'asc' } });
}

async function storedImage() {
  const row = await prisma.setting.findUnique({ where: { key: EMPLOYER_SIGNATURE_KEY } });
  return employerSignatureValueSchema.parse(row?.value);
}

describe('GET /api/settings', () => {
  it('gives the built-in defaults when nothing is stored', async () => {
    await prisma.setting.deleteMany();
    const response = await getSettings();
    expect(response.status).toBe(200);
    expect(itemOf(response)).toEqual({
      reminderIntervalDays: 3,
      maxReminders: null,
      linkExpiryDays: 60,
      senderName: 'מערכת חתימות',
      hrContact: envHrContact(),
      employerSignature: null,
    });
  });
});

/** The HR contact from the environment (the built-in default, 3.13). */
function envHrContact() {
  const { name, phone, email } = app.get(AppConfig).email.hrContact;
  return { name, phone: phone ?? null, email: email ?? null };
}

describe('the HR contact (3.13)', () => {
  it('saves it, logs each changed part, and the signing pages and emails read it', async () => {
    const before = envHrContact();
    const hrContact = { name: ' צוות משאבי אנוש ', phone: '03-7654321', email: 'HR@Example.org' };
    const response = await patchSettings({ hrContact });
    expect(response.status).toBe(200);
    const saved = { name: 'צוות משאבי אנוש', phone: '03-7654321', email: 'hr@example.org' };
    expect(itemOf(response).hrContact).toEqual(saved);
    expect(await app.get(SettingsService).getHrContact()).toEqual(saved);

    const [row] = await auditOf('settings.updated');
    const changes = (row?.details as { changes: string[] }).changes;
    expect(changes).toContain(`hrContact.name: ${before.name} → צוות משאבי אנוש`);
    expect(changes).toContain(`hrContact.phone: ${String(before.phone)} → 03-7654321`);
    expect(changes.filter((line) => line.startsWith('hrContact.'))).toHaveLength(
      ['name', 'phone', 'email'].filter(
        (part) => before[part as keyof typeof before] !== saved[part as keyof typeof saved],
      ).length,
    );
  });

  it('the same contact again → no audit row', async () => {
    await patchSettings({ hrContact: envHrContact() });
    expect(await auditOf('settings.updated')).toEqual([]);
  });

  it.each([
    ['neither phone nor email', { name: 'משאבי אנוש', phone: null, email: null }],
    ['a broken phone', { name: 'משאבי אנוש', phone: 'abc', email: null }],
    ['a broken email', { name: 'משאבי אנוש', phone: null, email: 'not-an-email' }],
    ['an empty name', { name: ' ', phone: '02-1234567', email: null }],
    ['a name on two lines', { name: 'א\nב', phone: '02-1234567', email: null }],
    ['a missing part', { name: 'משאבי אנוש', phone: '02-1234567' }],
  ])('%s → 400, nothing saved', async (_label, hrContact) => {
    const response = await patchSettings({ hrContact });
    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_FAILED');
    expect(itemOf(await getSettings()).hrContact).toEqual(envHrContact());
  });

  it('an officer cannot change it', async () => {
    const response = await server()
      .patch('/api/settings')
      .set('Cookie', officerCookie)
      .send({ hrContact: { name: 'א', phone: '02-1234567', email: null } });
    expect(response.status).toBe(403);
    expect(itemOf(await getSettings()).hrContact).toEqual(envHrContact());
  });
});

describe('PATCH /api/settings', () => {
  it('saves the changed values and logs "field: old → new"', async () => {
    const response = await patchSettings({
      reminderIntervalDays: 5,
      maxReminders: 4,
      linkExpiryDays: 60,
      senderName: '  משאבי אנוש ',
    });
    expect(response.status).toBe(200);
    expect(itemOf(response)).toMatchObject({
      reminderIntervalDays: 5,
      maxReminders: 4,
      linkExpiryDays: 60,
      senderName: 'משאבי אנוש',
    });
    expect(itemOf(await getSettings())).toEqual(itemOf(response));

    const [log, ...more] = await auditOf('settings.updated');
    expect(more).toEqual([]);
    expect(log).toMatchObject({
      entityType: 'settings',
      entityId: null,
      details: {
        // linkExpiryDays was already 60: not a change.
        changes: [
          'reminderIntervalDays: 3 → 5',
          'maxReminders: null → 4',
          'senderName: מערכת חתימות → משאבי אנוש',
        ],
      },
    });
    const row = await prisma.setting.findUnique({ where: { key: 'reminder_interval_days' } });
    expect(row?.value).toBe(5);
    expect(row?.updatedById).toBe(log?.userId);
  });

  it('works when the row was never stored, and back to no limit', async () => {
    await prisma.setting.deleteMany();
    expect((await patchSettings({ maxReminders: 2 })).status).toBe(200);
    const response = await patchSettings({ maxReminders: null });
    expect(itemOf(response).maxReminders).toBeNull();
    const logs = await auditOf('settings.updated');
    expect(logs.map(({ details }) => details)).toEqual([
      { changes: ['maxReminders: null → 2'] },
      { changes: ['maxReminders: 2 → null'] },
    ]);
  });

  it('nothing different → 200, no audit row', async () => {
    const response = await patchSettings({ reminderIntervalDays: 3 });
    expect(response.status).toBe(200);
    expect(await auditOf('settings.updated')).toEqual([]);
  });

  it.each([
    ['an empty body', {}],
    ['an unknown field', { reminderIntervalDays: 4, colour: 'red' }],
    ['interval 0', { reminderIntervalDays: 0 }],
    ['interval 31', { reminderIntervalDays: 31 }],
    ['interval 2.5', { reminderIntervalDays: 2.5 }],
    ['interval as text', { reminderIntervalDays: '3' }],
    ['max reminders 0', { maxReminders: 0 }],
    ['max reminders 51', { maxReminders: 51 }],
    ['expiry 0', { linkExpiryDays: 0 }],
    ['expiry 366', { linkExpiryDays: 366 }],
    ['expiry null', { linkExpiryDays: null }],
    ['an empty sender name', { senderName: '  ' }],
    ['a sender name on two lines', { senderName: 'שם\nBcc: x@example.com' }],
    ['a too-long sender name', { senderName: 'א'.repeat(101) }],
  ])('%s → 400, nothing saved', async (_label, body) => {
    const response = await patchSettings(body);
    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_FAILED');
    expect(await auditOf('settings.updated')).toEqual([]);
    expect(itemOf(await getSettings())).toMatchObject({
      reminderIntervalDays: 3,
      maxReminders: null,
      linkExpiryDays: 60,
      senderName: 'מערכת חתימות',
    });
  });
});

describe('POST /api/settings/employer-signature', () => {
  it('stores the PNG under a new ASCII key and logs it', async () => {
    const bytes = testPng({ width: 1200, height: 500 });
    const response = await uploadImage(bytes);
    expect(response.status).toBe(201);
    const summary = employerSignatureSummarySchema.parse(response.body);
    expect(summary).toMatchObject({ width: 1200, height: 500 });

    const stored = await storedImage();
    expect(stored.fileKey).toMatch(/^settings\/employer-signature\/[0-9a-f-]{36}\.png$/);
    expect(await app.get(StorageAdapter).download(stored.fileKey)).toEqual(bytes);
    expect(itemOf(await getSettings()).employerSignature).toEqual(summary);
    // The settings screen never sees the storage key.
    expect(JSON.stringify(response.body)).not.toContain('settings/');

    const [log] = await auditOf('settings.employer_signature_uploaded');
    expect(log).toMatchObject({
      entityType: 'settings',
      details: {
        fileId: stored.fileKey.slice(-40, -4),
        width: 1200,
        height: 500,
        size: bytes.length,
        fileSha256: stored.sha256,
        replacedFileId: null,
      },
    });
  });

  it('replacing it creates a new file; the old one still exists', async () => {
    expect((await uploadImage(testPng())).status).toBe(201);
    const first = await storedImage();
    expect((await uploadImage(testPng({ width: 600, height: 200 }))).status).toBe(201);
    const second = await storedImage();

    expect(second.fileKey).not.toBe(first.fileKey);
    const storage = app.get(StorageAdapter);
    expect(await storage.exists(first.fileKey)).toBe(true);
    expect(await storage.exists(second.fileKey)).toBe(true);
    expect(second).toMatchObject({ width: 600, height: 200 });
    const logs = await auditOf('settings.employer_signature_uploaded');
    expect(logs[1]?.details).toMatchObject({ replacedFileId: first.fileKey.slice(-40, -4) });
  });

  it.each([
    ['a JPG renamed .png', testJpegBytes(), 'INVALID_PNG_FILE'],
    ['a text file', Buffer.from('just text'), 'INVALID_PNG_FILE'],
    ['a cut-off PNG', testPng({ cutImageData: true }), 'INVALID_PNG_FILE'],
    ['an image 50 pixels high', testPng({ width: 400, height: 50 }), 'PNG_DIMENSIONS_INVALID'],
    ['an image 3500 pixels wide', testPng({ width: 3500, height: 100 }), 'PNG_DIMENSIONS_INVALID'],
  ])('%s → 400, nothing saved', async (_label, bytes, code) => {
    const response = await uploadImage(bytes);
    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe(code);
    expect(await prisma.setting.findUnique({ where: { key: EMPLOYER_SIGNATURE_KEY } })).toBeNull();
    expect(await auditOf('settings.employer_signature_uploaded')).toEqual([]);
  });

  it('a file over 1 MB → 400 FILE_TOO_LARGE', async () => {
    const big = Buffer.concat([testPng(), Buffer.alloc(EMPLOYER_SIGNATURE_MAX_BYTES)]);
    const response = await uploadImage(big);
    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('FILE_TOO_LARGE');
  });

  it('no file → 400 FILE_REQUIRED', async () => {
    const response = await server()
      .post('/api/settings/employer-signature')
      .set('Cookie', managerCookie)
      .field('note', 'x');
    expect(response.status).toBe(400);
  });
});

describe('GET /api/settings/employer-signature', () => {
  it('no image yet → 404', async () => {
    const response = await server()
      .get('/api/settings/employer-signature')
      .set('Cookie', managerCookie);
    expect(response.status).toBe(404);
    expect(await auditOf('settings.employer_signature_viewed')).toEqual([]);
  });

  it('gives a short-lived link to the current image and logs the view', async () => {
    const bytes = testPng();
    await uploadImage(bytes);
    const before = Date.now();
    const response = await server()
      .get('/api/settings/employer-signature')
      .set('Cookie', managerCookie);
    expect(response.status).toBe(200);
    const link = employerSignatureLinkSchema.parse(response.body);
    const expiresIn = Date.parse(link.expiresAt) - before;
    expect(expiresIn).toBeGreaterThan(0);
    expect(expiresIn).toBeLessThanOrEqual(5 * 60 * 1000 + 1000);

    const file = await fetch(link.url);
    expect(file.status).toBe(200);
    expect(Buffer.from(await file.arrayBuffer())).toEqual(bytes);

    const [log] = await auditOf('settings.employer_signature_viewed');
    expect(log?.details).toEqual({ fileId: (await storedImage()).fileKey.slice(-40, -4) });
  });
});

describe('access: managers only', () => {
  const routes = [
    ['GET /api/settings', (r: ReturnType<typeof server>) => r.get('/api/settings')],
    [
      'PATCH /api/settings',
      (r: ReturnType<typeof server>) => r.patch('/api/settings').send({ reminderIntervalDays: 4 }),
    ],
    [
      'POST /api/settings/employer-signature',
      (r: ReturnType<typeof server>) =>
        r.post('/api/settings/employer-signature').attach('file', testPng(), 'חתימה.png'),
    ],
    [
      'GET /api/settings/employer-signature',
      (r: ReturnType<typeof server>) => r.get('/api/settings/employer-signature'),
    ],
  ] as const;

  it.each(routes)('%s: officer 403, signed out 401', async (_name, call) => {
    await uploadImage(testPng());
    const asOfficer = await call(server()).set('Cookie', officerCookie);
    expect(asOfficer.status).toBe(403);
    const signedOut = await call(server());
    expect(signedOut.status).toBe(401);
    // Nothing changed, and only the manager's own upload is logged.
    expect(itemOf(await getSettings()).reminderIntervalDays).toBe(3);
    expect(await auditOf('settings.employer_signature_uploaded')).toHaveLength(1);
    expect(await auditOf('settings.employer_signature_viewed')).toEqual([]);
  });
});
