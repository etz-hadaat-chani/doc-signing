import { createHash } from 'node:crypto';
import { type SignSubmittedResult, todayInIsrael } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { SIGNED_COPY_QUEUE } from '../../src/common/queue/queue.definitions.js';
import { StorageAdapter } from '../../src/common/storage/storage.adapter.js';
import { readPdfImages, readPdfText } from '../fixtures/pdf-text.js';
import { asDataUrl, drawnPng } from '../fixtures/png.js';
import { createTestApp } from '../setup/app.js';
import { jobsOf } from '../setup/round-actions.js';
import { type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import {
  errorOf,
  initialsPng,
  signAs,
  type SigningRound,
  signingRound,
  signServer,
  validSubmit,
  verifiedCookie,
} from '../setup/signing.js';
import { clearQueueJobs } from '../setup/worker.js';

/** Submit (3.13): the signed PDF, its file, the answers, the status, the signed copy's job. */

let app: INestApplication;
let prisma: PrismaService;
let storage: StorageAdapter;
let world: RoundsWorld;
let round: SigningRound;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  storage = app.get(StorageAdapter);
});

beforeEach(async () => {
  world = await seedRoundsWorld(app, prisma);
  await clearQueueJobs(prisma);
  round = await signingRound(app, prisma, world, ['1001', '1002', '1003']);
});

afterAll(async () => {
  await app.close();
});

const person = (number: string) => {
  const found = round.people[number];
  if (!found) throw new Error(`no person ${number}`);
  return found;
};
const assignmentOf = (number: string) =>
  prisma.assignment.findUniqueOrThrow({ where: { id: person(number).assignmentId } });
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('POST /api/sign/:token/submit', () => {
  it('signs: the file at the send-time department, its hash, the answers, the copy queued', async () => {
    // She moved department after the round was created: the file keeps the old one (15).
    const dept19 = world.dept[19];
    await prisma.employee.update({
      where: { id: person('1001').employeeId },
      data: { departmentId: dept19 },
    });

    const cookie = await verifiedCookie(app, person('1001'));
    const response = await signServer(app)
      .post(`/api/sign/${person('1001').token}/submit`)
      .set('Cookie', cookie)
      .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0) test-browser')
      .send(validSubmit());
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const result = response.body as SignSubmittedResult;
    expect(result.state).toBe('signed');

    const row = await assignmentOf('1001');
    expect(row.status).toBe('signed');
    expect(row.signMethod).toBe('digital');
    expect(row.signedAt?.toISOString()).toBe(result.signedAt);
    expect(row.signedFileKey).toBe(`rounds/${round.roundId}/15/1001.pdf`);
    expect(row.signerIp).toMatch(/127\.0\.0\.1|::1/);
    expect(row.signerUserAgent).toBe('Mozilla/5.0 (Windows NT 10.0) test-browser');
    expect(row.needsApproval).toBe(true);

    const stored = await storage.download(row.signedFileKey ?? '');
    expect(row.signedFileSha256).toBe(sha256(stored));
    const text = (await readPdfText(stored)).map(({ str }) => str).join(' ');
    expect(text).toContain('דנה כהן');
    expect(text).toContain('dana.new@example.com');

    const responses = await prisma.assignmentResponse.findMany({
      where: { assignmentId: row.id },
      orderBy: { key: 'asc' },
    });
    const byKey = Object.fromEntries(responses.map((r) => [r.key, r]));
    expect(byKey.email_choice?.value).toBe('email');
    expect(byKey.email?.value).toBe('dana.new@example.com');
    expect(byKey.nickname?.value).toBe('דנה כהן');
    expect(byKey.shift?.value).toBe('בוקר');
    expect(byKey.start?.value).toBe(todayInIsrael());
    expect(byKey.agree?.value).toBe('true');
    expect(byKey.nickname?.templateFieldId).not.toBeNull();
    expect(byKey.initials?.value).toBeNull();
    expect(byKey.initials?.fileKey).toBe(`responses/${row.id}/initials.png`);
    expect(await storage.download(byKey.initials?.fileKey ?? '')).toEqual(initialsPng());

    // The employee card's email is never changed by her answer (FR-SGN-9).
    const employee = await prisma.employee.findUniqueOrThrow({
      where: { id: person('1001').employeeId },
    });
    expect(employee.email).toBe(person('1001').email);

    const copies = await prisma.emailMessage.findMany({
      where: { assignmentId: row.id, type: 'signed_copy' },
    });
    expect(copies).toHaveLength(1);
    expect(copies[0]?.toEmail).toBe(person('1001').email);
    expect(await jobsOf(prisma, SIGNED_COPY_QUEUE.name)).toEqual([
      {
        data: { assignmentId: row.id, emailMessageId: copies[0]?.id },
        singletonKey: row.id,
      },
    ]);

    const [audit] = await prisma.auditLog.findMany({ where: { action: 'assignment.signed' } });
    expect(audit?.actorType).toBe('employee');
    expect(audit?.details).toMatchObject({
      fileSha256: row.signedFileSha256,
      emailChoice: 'email',
      answeredKeys: expect.arrayContaining(['nickname', 'shift', 'start', 'agree']) as unknown,
      drawingKeys: ['initials'],
      needsApproval: true,
      fileReused: false,
      strayFileKeys: [],
    });
    const auditText = JSON.stringify(audit?.details);
    expect(auditText).not.toContain('dana.new');
    expect(auditText).not.toContain('דנה');
  });

  it('a signature appears at the "office" line only for the office choice', async () => {
    const office = await signAs(
      app,
      person('1002'),
      validSubmit({ emailChoice: 'office', email: undefined }),
    );
    expect(office.status, JSON.stringify(office.body)).toBe(201);
    const row = await assignmentOf('1002');
    const images = await readPdfImages(await storage.download(row.signedFileKey ?? ''));
    // Main signature, office signature, the initials drawing.
    expect(images).toHaveLength(3);
    const choices = await prisma.assignmentResponse.findMany({ where: { assignmentId: row.id } });
    expect(choices.find((r) => r.key === 'email_choice')?.value).toBe('office');
    expect(choices.find((r) => r.key === 'email')).toBeUndefined();
  });

  it('afterwards every link shows "already signed"', async () => {
    expect((await signAs(app, person('1001'))).status).toBe(201);
    const state = await signServer(app).get(`/api/sign/${person('1001').token}`);
    expect(state.body).toMatchObject({ state: 'signed' });
    const again = await signServer(app)
      .post(`/api/sign/${person('1001').token}/verify`)
      .send({ idNumber: person('1001').idNumber });
    expect(again.status).toBe(409);
    expect(errorOf(again).code).toBe('SIGN_ALREADY_SIGNED');
  });

  const answers = (over: Record<string, unknown>) => ({
    answers: { nickname: 'דנה כהן', shift: 'בוקר', start: todayInIsrael(), ...over },
  });

  it.each([
    ['no email choice', { emailChoice: undefined }, 'EMAIL_CHOICE_REQUIRED', 'emailChoice'],
    ['a bad email', { email: 'dana@@example' }, 'INVALID_EMAIL', 'email'],
    [
      'an email of 255 characters',
      { email: `${'a'.repeat(243)}@example.com` },
      'INVALID_EMAIL',
      'email',
    ],
    ['a required box empty', answers({ nickname: '  ' }), 'ANSWER_REQUIRED', 'answers.nickname'],
    [
      'text over its limit',
      answers({ nickname: 'א'.repeat(101) }),
      'ANSWER_TOO_LONG',
      'answers.nickname',
    ],
    [
      'a date out of range',
      answers({ start: '2031-01-01' }),
      'ANSWER_DATE_OUT_OF_RANGE',
      'answers.start',
    ],
    [
      'a date before the signing day',
      answers({ start: '2020-01-01' }),
      'ANSWER_DATE_OUT_OF_RANGE',
      'answers.start',
    ],
    [
      'an option not in the list',
      answers({ shift: 'לילה' }),
      'ANSWER_NOT_A_CHOICE',
      'answers.shift',
    ],
    ['a box that does not exist', answers({ salary: '1' }), 'ANSWER_UNKNOWN_BOX', 'answers.salary'],
    ['no acknowledgement', { acknowledged: false }, 'SIGN_ACK_REQUIRED', 'acknowledged'],
  ])('%s → 400, nothing signed or stored', async (_label, over, code, field) => {
    const response = await signAs(app, person('1001'), validSubmit(over));
    expect(response.status, JSON.stringify(response.body)).toBe(400);
    expect(errorOf(response)).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { fields: [expect.objectContaining({ field, code })] as unknown },
    });
    const row = await assignmentOf('1001');
    expect(row.status).toBe('opened');
    expect(row.signedFileKey).toBeNull();
    expect(await prisma.assignmentResponse.count({ where: { assignmentId: row.id } })).toBe(0);
    expect(await storage.exists(`rounds/${round.roundId}/15/1001.pdf`)).toBe(false);
  });

  it('text that fits its limit but not its place → 400 ANSWER_DOES_NOT_FIT with the key', async () => {
    const response = await signAs(
      app,
      person('1001'),
      validSubmit(answers({ nickname: 'שלום '.repeat(19) })),
    );
    expect(response.status).toBe(400);
    expect(errorOf(response)).toMatchObject({
      code: 'ANSWER_DOES_NOT_FIT',
      details: { key: 'nickname' },
    });
  });

  it('a body over 5 MB → 413; other routes keep the 100 KB limit', async () => {
    const cookie = await verifiedCookie(app, person('1001'));
    const huge = await signServer(app)
      .post(`/api/sign/${person('1001').token}/submit`)
      .set('Cookie', cookie)
      .send(validSubmit({ email: 'a'.repeat(5 * 1024 * 1024) }));
    expect(huge.status).toBe(413);
    expect(errorOf(huge).code).toBe('PAYLOAD_TOO_LARGE');
    const bigVerify = await signServer(app)
      .post(`/api/sign/${person('1001').token}/verify`)
      .send({ idNumber: '1'.repeat(200 * 1024) });
    expect(bigVerify.status).toBe(413);
  });

  /** Undoes a signature in the database only (the files stay), as if the transaction failed. */
  async function undoSignature(number: string) {
    const { assignmentId } = person(number);
    await prisma.assignmentResponse.deleteMany({ where: { assignmentId } });
    await prisma.emailMessage.deleteMany({ where: { assignmentId, type: 'signed_copy' } });
    await clearQueueJobs(prisma);
    await prisma.assignment.update({
      where: { id: assignmentId },
      data: {
        status: 'opened',
        signedAt: null,
        signMethod: null,
        signedFileKey: null,
        signedFileSha256: null,
        signerIp: null,
        signerUserAgent: null,
        needsApproval: false,
      },
    });
  }

  it('a retry with the same answers keeps the stored file and stores ITS hash', async () => {
    expect((await signAs(app, person('1001'))).status).toBe(201);
    const first = await assignmentOf('1001');
    const firstBytes = await storage.download(first.signedFileKey ?? '');
    await undoSignature('1001');
    // A later second: a new build would differ (its time); the stored file wins.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const retry = await signAs(app, person('1001'));
    expect(retry.status, JSON.stringify(retry.body)).toBe(201);
    const again = await assignmentOf('1001');
    expect(again.signedFileKey).toBe(first.signedFileKey);
    expect(again.signedFileSha256).toBe(sha256(firstBytes));
    expect(again.signedAt).toEqual(first.signedAt);
    expect(await storage.exists(`rounds/${round.roundId}/15/1001-2.pdf`)).toBe(false);
    const audits = await prisma.auditLog.findMany({
      where: { action: 'assignment.signed' },
      orderBy: { id: 'asc' },
    });
    expect(audits[1]?.details).toMatchObject({ fileReused: true, strayFileKeys: [] });
  });

  it('a retry with a changed answer stores a "-2" file; the first is reported as stray', async () => {
    expect((await signAs(app, person('1001'))).status).toBe(201);
    await undoSignature('1001');
    const changed = validSubmit(answers({ nickname: 'דנה לוי' }));
    const retry = await signAs(app, person('1001'), changed);
    expect(retry.status, JSON.stringify(retry.body)).toBe(201);

    const row = await assignmentOf('1001');
    const base = `rounds/${round.roundId}/15/1001`;
    expect(row.signedFileKey).toBe(`${base}-2.pdf`);
    const stored = await storage.download(row.signedFileKey ?? '');
    expect(row.signedFileSha256).toBe(sha256(stored));
    const text = (await readPdfText(stored)).map(({ str }) => str).join(' ');
    expect(text).toContain('דנה לוי');
    const nickname = await prisma.assignmentResponse.findFirst({
      where: { assignmentId: row.id, key: 'nickname' },
    });
    expect(nickname?.value).toBe('דנה לוי');
    const [, second] = await prisma.auditLog.findMany({
      where: { action: 'assignment.signed' },
      orderBy: { id: 'asc' },
    });
    // The drawing didn't change: reused, not stray.
    expect(second?.details).toMatchObject({ strayFileKeys: [`${base}.pdf`], fileReused: false });
  });

  it('an empty drawing pad is refused with its key', async () => {
    const blank = asDataUrl(drawnPng({ width: 150, height: 80 }));
    const response = await signAs(
      app,
      person('1001'),
      validSubmit({ drawings: { initials: blank } }),
    );
    expect(response.status).toBe(400);
    expect(errorOf(response)).toMatchObject({
      code: 'DRAWING_EMPTY',
      details: { key: 'initials' },
    });
  });
});
