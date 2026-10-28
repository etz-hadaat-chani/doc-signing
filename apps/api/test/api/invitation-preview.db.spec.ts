import {
  type ApiError,
  formatDate,
  type InvitationPreview,
  invitationPreviewSchema,
  templateItemSchema,
} from '@doc-signing/shared';
import { type INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSeed } from '../../prisma/run-seed.js';
import { EmailAdapter } from '../../src/common/email/email.adapter.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { testPdf } from '../fixtures/pdf.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { resetDatabase } from '../setup/database.js';

const seedPassword = 'test-seed-password';
const DAY_MS = 24 * 60 * 60 * 1000;

let app: INestApplication;
let prisma: PrismaService;
let managerCookie: string;
let officerCookie: string;
let templateId: string;
let logLines: string[];

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  await resetDatabase(prisma);
  await runSeed(prisma, { password: seedPassword });
  managerCookie = await cookieFor('manager@doc-signing.local');
  officerCookie = await cookieFor('officer@doc-signing.local');
  const department = await prisma.department.findFirstOrThrow({ orderBy: { code: 'asc' } });
  const created = await server()
    .post('/api/templates')
    .set('Cookie', managerCookie)
    .field('name', 'הצהרת סודיות')
    .field('departmentIds', department.id)
    .attach('file', await testPdf(), 'הצהרה.pdf');
  expect(created.status).toBe(201);
  templateId = templateItemSchema.parse(created.body).id;
  logLines = [];
  for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation((...parts: unknown[]) => {
      logLines.push(parts.map(String).join(' '));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
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
  return (lines.find((value) => value.startsWith('sid=')) ?? '').split(';')[0] ?? '';
}

const server = () => request(httpServer(app));
const errorOf = (response: request.Response) => (response.body as ApiError).error;

function invitationPreview(
  id: string,
  query: Record<string, string> = {},
  cookie: string | null = managerCookie,
) {
  const req = server().get(`/api/templates/${id}/invitation-preview`).query(query);
  if (cookie) req.set('Cookie', cookie);
  return req;
}

const previewOf = (response: request.Response): InvitationPreview =>
  invitationPreviewSchema.parse(response.body);

/** Rows that would show anything was sent, queued or logged. */
async function sideEffects() {
  const [emails, audits, jobs] = await Promise.all([
    prisma.emailMessage.count(),
    prisma.auditLog.count(),
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pgboss.job WHERE name <> 'maintenance-cleanup'`,
  ]);
  return { emails, audits, jobs: Number(jobs[0]?.n ?? 0) };
}

describe('GET /api/templates/:id/invitation-preview', () => {
  it('renders the invitation for the document, a sample name and a placeholder link', async () => {
    const before = Date.now();
    const response = await invitationPreview(templateId, { linkExpiryDays: '30' });
    const after = Date.now();

    expect(response.status).toBe(200);
    const preview = previewOf(response);
    expect(preview.subject).toBe('מסמך לחתימה: הצהרת סודיות');
    expect(preview.senderName).toBe('מערכת חתימות');
    expect(preview.text).toMatch(/\/sign\/example-link$/m);
    expect(preview.html).toContain('/sign/example-link');
    expect(preview.text).toContain('שירה');
    // now + 30 × 24 h, the send's rule, shown as the Israeli day.
    const expiresAt = new Date(preview.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 30 * DAY_MS);
    expect(expiresAt).toBeLessThanOrEqual(after + 30 * DAY_MS);
    expect(preview.text).toContain(`הקישור בתוקף עד ${formatDate(preview.expiresAt)}.`);
  });

  it('takes the link_expiry_days setting when no days are given', async () => {
    const patched = await server()
      .patch('/api/settings')
      .set('Cookie', managerCookie)
      .send({ linkExpiryDays: 45 });
    expect(patched.status).toBe(200);
    const before = Date.now();
    const preview = previewOf(await invitationPreview(templateId));
    expect(new Date(preview.expiresAt).getTime()).toBeGreaterThanOrEqual(before + 45 * DAY_MS);
    expect(new Date(preview.expiresAt).getTime()).toBeLessThan(before + 46 * DAY_MS);
  });

  it('sends, stores, queues and logs nothing, and never calls the email adapter', async () => {
    const send = vi.spyOn(app.get(EmailAdapter), 'send');
    const before = await sideEffects();

    expect((await invitationPreview(templateId)).status).toBe(200);
    expect((await invitationPreview(templateId, { linkExpiryDays: '7' })).status).toBe(200);

    expect(send).not.toHaveBeenCalled();
    expect(await sideEffects()).toEqual(before);
  });

  it('holds no address of an employee, nor the sample one', async () => {
    const employees = await prisma.employee.findMany({
      where: { email: { not: null } },
      select: { email: true },
    });
    expect(employees.length).toBeGreaterThan(0);
    const response = await invitationPreview(templateId);
    const answer = JSON.stringify(response.body);
    const logged = logLines.join('\n');
    for (const address of [...employees.map(({ email }) => email ?? ''), 'shira.sample']) {
      expect(answer).not.toContain(address);
      expect(logged).not.toContain(address);
    }
    expect(Object.keys(response.body as object).sort()).toEqual([
      'expiresAt',
      'html',
      'senderName',
      'subject',
      'text',
    ]);
  });

  it('is for managers only', async () => {
    const officer = await invitationPreview(templateId, {}, officerCookie);
    expect(officer.status).toBe(403);
    const signedOut = await invitationPreview(templateId, {}, null);
    expect(signedOut.status).toBe(401);
  });

  it('answers 404 for an unknown template and 400 for a bad id', async () => {
    const unknown = await invitationPreview('00000000-0000-4000-8000-000000000000');
    expect(unknown.status).toBe(404);
    expect(errorOf(unknown).code).toBe('NOT_FOUND');
    const bad = await invitationPreview('not-a-uuid');
    expect(bad.status).toBe(400);
  });

  it.each(['0', '366', '1.5', 'abc', '-3'])('refuses linkExpiryDays=%s', async (days) => {
    const response = await invitationPreview(templateId, { linkExpiryDays: days });
    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_FAILED');
  });

  it('refuses an unknown query parameter', async () => {
    const response = await invitationPreview(templateId, { to: 'someone@example.com' });
    expect(response.status).toBe(400);
  });
});
