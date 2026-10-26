import { createHash } from 'node:crypto';
import { MANUAL_SCAN_MAX_BYTES, manualSignedSchema } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashSigningToken, newSigningToken } from '../../src/common/email/signing-token.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { StorageAdapter } from '../../src/common/storage/storage.adapter.js';
import { testPdf } from '../fixtures/pdf.js';
import { readPdfText } from '../fixtures/pdf-text.js';
import { testJpegBytes, testPng } from '../fixtures/png.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { manualRound } from '../setup/manual-handling.js';
import { errorOf, postAction, type SentRound } from '../setup/round-actions.js';
import { type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import { setState } from '../setup/tracking.js';
import { clearQueueJobs } from '../setup/worker.js';

/** Print and the scanned paper signature (3.16 part A, FR-MAN-2, FR-MAN-3). Made-up data only. */

let app: INestApplication;
let prisma: PrismaService;
let storage: StorageAdapter;
let world: RoundsWorld;
let round: SentRound;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  storage = app.get(StorageAdapter);
});

beforeEach(async () => {
  world = await seedRoundsWorld(app, prisma);
  await clearQueueJobs(prisma);
  round = await manualRound(app, prisma, world);
});

afterAll(async () => {
  await app.close();
});

const idOf = (number: string) => round.assignment[number] ?? '';
const rowOf = (number: string) =>
  prisma.assignment.findUniqueOrThrow({ where: { id: idOf(number) } });
const audits = (action: string) => prisma.auditLog.findMany({ where: { action } });
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function print(number: string, cookie: string | null = world.managerCookie) {
  const req = request(httpServer(app))
    .get(`/api/assignments/${idOf(number)}/print`)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
  if (cookie) req.set('Cookie', cookie);
  return req;
}

function upload(
  number: string,
  file: Buffer,
  name = 'סריקה.pdf',
  cookie: string | null = world.managerCookie,
) {
  const req = request(httpServer(app))
    .post(`/api/assignments/${idOf(number)}/manual-sign`)
    .attach('file', file, name);
  if (cookie) req.set('Cookie', cookie);
  return req;
}

/** The error code of a print answer (read as bytes, like the PDF). */
const printError = (response: request.Response) =>
  (JSON.parse((response.body as Buffer).toString('utf8')) as { error: { code: string } }).error
    .code;

/** The key the scan goes to: the round, the department at send (15), the employee number. */
const keyOf = (number: string) => `rounds/${round.roundId}/15/${number}.pdf`;

describe('GET /api/assignments/:id/print', () => {
  it('draws the saved values (not the card as it is now), inline, Hebrew name, never cached', async () => {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: world.emp['1003'] } });
    await prisma.employee.update({
      where: { id: employee.id },
      data: { firstName: 'שונה', address: 'רחוב אחר 1' },
    });
    const response = await print('1003');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['cache-control']).toContain('no-store');
    const disposition = String(response.headers['content-disposition']);
    expect(disposition).toMatch(/^inline;/);
    // The file name uses the name as it is now; the document inside, the saved values.
    expect(decodeURIComponent(disposition.split("UTF-8''")[1] ?? '')).toBe(
      `הצהרה - שונה ${employee.lastName}.pdf`,
    );
    const text = (await readPdfText(response.body as Buffer)).map(({ str }) => str).join(' ');
    expect(text).toContain(employee.idNumber);
    expect(text).toContain(`${employee.firstName} ${employee.lastName}`);
    expect(text).not.toContain('שונה');
  });

  it('prints no_email and invalid_email rows, also locked or expired', async () => {
    expect((await print('1001')).status).toBe(200);
    expect((await print('1004')).status).toBe(200);
    await prisma.assignment.update({
      where: { id: idOf('1003') },
      data: { lockedAt: new Date(), failedAttempts: 5 },
    });
    await prisma.round.update({
      where: { id: round.roundId },
      data: { linkExpiresAt: new Date(Date.now() - 1000) },
    });
    expect((await print('1003')).status).toBe(200);
  });

  it('409 for missing data (nothing saved yet), signed, signed manually and cancelled', async () => {
    const missing = await print('1002');
    expect(missing.status).toBe(409);
    expect(printError(missing)).toBe('ASSIGNMENT_NOT_PRINTABLE');
    await setState(prisma, idOf('1003'), world.managerId, { status: 'signed' });
    expect(printError(await print('1003'))).toBe('ASSIGNMENT_ALREADY_SIGNED');
    await setState(prisma, idOf('1003'), world.managerId, { status: 'signed_manual' });
    expect(printError(await print('1003'))).toBe('ASSIGNMENT_ALREADY_SIGNED');
    await setState(prisma, idOf('1003'), world.managerId, { status: 'cancelled' });
    expect(printError(await print('1003'))).toBe('ASSIGNMENT_ALREADY_CANCELLED');
  });

  it('logs a document view with ids only', async () => {
    await print('1003');
    const [row, ...rest] = await audits('assignment.printed');
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ entityId: idOf('1003'), userId: world.managerId });
    expect(row?.details).toEqual({ roundId: round.roundId, templateId: round.templateId });
  });

  it('is manager only: officer 403, signed out 401; unknown 404, bad id 400', async () => {
    expect((await print('1003', world.officerCookie)).status).toBe(403);
    expect((await print('1003', null)).status).toBe(401);
    const unknown = await request(httpServer(app))
      .get('/api/assignments/00000000-0000-4000-8000-000000000000/print')
      .set('Cookie', world.managerCookie);
    expect(unknown.status).toBe(404);
    const bad = await request(httpServer(app))
      .get('/api/assignments/abc/print')
      .set('Cookie', world.managerCookie);
    expect(bad.status).toBe(400);
    expect(await audits('assignment.printed')).toEqual([]);
  });
});

describe('POST /api/assignments/:id/manual-sign', () => {
  it('stores the scan, signed manually: method, hash of the stored bytes, department at send', async () => {
    // Moved after the send: the file still goes to the department it was sent in (15).
    await prisma.employee.update({
      where: { id: world.emp['1001'] },
      data: { departmentId: world.dept[19] },
    });
    const scan = await testPdf({
      pages: [
        [595, 842],
        [595, 842],
      ],
    });
    const response = await upload('1001', scan);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const body = manualSignedSchema.parse(response.body);
    expect(body).toMatchObject({
      assignmentId: idOf('1001'),
      roundId: round.roundId,
      status: 'signed_manual',
      fileSha256: sha256(scan),
    });
    const row = await rowOf('1001');
    expect(row).toMatchObject({
      status: 'signed_manual',
      signMethod: 'manual',
      signedFileKey: keyOf('1001'),
      signedFileSha256: sha256(scan),
      handledById: world.managerId,
      needsApproval: false,
      signerIp: null,
    });
    expect(row.signedAt?.toISOString()).toBe(body.signedAt);
    expect(await storage.download(keyOf('1001'))).toEqual(scan);
    expect(await prisma.assignmentResponse.count({ where: { assignmentId: idOf('1001') } })).toBe(
      0,
    );
  });

  it('after it: every link says "already signed", reminders are refused, no signed copy is emailed', async () => {
    const token = newSigningToken();
    await prisma.emailMessage.create({
      data: {
        assignmentId: idOf('1003'),
        type: 'reminder',
        toEmail: 'old-link@example.com',
        status: 'sent',
        tokenHash: hashSigningToken(token),
        sentAt: new Date(),
      },
    });
    const queued = await prisma.emailMessage.create({
      data: {
        assignmentId: idOf('1003'),
        type: 'reminder',
        toEmail: 'x@example.com',
        status: 'queued',
      },
    });
    expect((await upload('1003', await testPdf())).status).toBe(201);
    const state = await request(httpServer(app)).get(`/api/sign/${token}`);
    expect((state.body as { state: string }).state).toBe('signed');
    const remind = await postAction(
      app,
      `/api/assignments/${idOf('1003')}/remind`,
      world.managerCookie,
    );
    expect(errorOf(remind).code).toBe('ASSIGNMENT_ALREADY_SIGNED');
    const emails = await prisma.emailMessage.findMany({ where: { assignmentId: idOf('1003') } });
    expect(emails.some(({ type }) => type === 'signed_copy')).toBe(false);
    // A reminder still queued goes nowhere: its job finds the row no longer `sent` / `opened`.
    expect(emails.find(({ id }) => id === queued.id)?.status).toBe('queued');
  });

  it('refuses a renamed JPG or PNG, an empty file, an encrypted PDF, a script (400); nothing stored', async () => {
    const cases: [Buffer, string, string][] = [
      [testJpegBytes(), 'scan.pdf', 'INVALID_PDF_FILE'],
      [testPng(), 'scan.pdf', 'INVALID_PDF_FILE'],
      [Buffer.alloc(0), 'scan.pdf', 'FILE_EMPTY'],
      [await testPdf({ encrypted: true }), 'scan.pdf', 'PDF_ENCRYPTED'],
      [await testPdf({ openActionScript: true }), 'scan.pdf', 'PDF_ACTIVE_CONTENT'],
    ];
    for (const [file, name, code] of cases) {
      const response = await upload('1001', file, name);
      expect(response.status, code).toBe(400);
      expect(errorOf(response).code).toBe(code);
    }
    expect(await storage.exists(keyOf('1001'))).toBe(false);
    expect((await rowOf('1001')).status).toBe('no_email');
  });

  it('refuses a file over the size limit (400 FILE_TOO_LARGE)', async () => {
    const big = Buffer.concat([await testPdf(), Buffer.alloc(MANUAL_SCAN_MAX_BYTES)]);
    const response = await upload('1001', big);
    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('FILE_TOO_LARGE');
  });

  it('never overwrites: another file at the key stays, the scan goes to -2', async () => {
    const earlier = await testPdf({ pages: [[612, 792]] });
    await storage.upload(keyOf('1003'), earlier, { contentType: 'application/pdf' });
    const scan = await testPdf();
    expect((await upload('1003', scan)).status).toBe(201);
    const row = await rowOf('1003');
    expect(row.signedFileKey).toBe(`rounds/${round.roundId}/15/1003-2.pdf`);
    expect(row.signedFileSha256).toBe(sha256(scan));
    expect(await storage.download(keyOf('1003'))).toEqual(earlier);
    const [audit] = await audits('assignment.signed_manual');
    expect(audit?.details).toMatchObject({ fileReused: false, strayFileKeys: [keyOf('1003')] });
  });

  it('keeps the same bytes already at the key (a retried upload)', async () => {
    const scan = await testPdf();
    await storage.upload(keyOf('1003'), scan, { contentType: 'application/pdf' });
    expect((await upload('1003', scan)).status).toBe(201);
    expect((await rowOf('1003')).signedFileKey).toBe(keyOf('1003'));
    const [audit] = await audits('assignment.signed_manual');
    expect(audit?.details).toMatchObject({ fileReused: true, strayFileKeys: [] });
  });

  it('409 for missing data, signed and cancelled rows, and a second upload; nothing stored', async () => {
    const missing = await upload('1002', await testPdf());
    expect(missing.status).toBe(409);
    expect(errorOf(missing).code).toBe('ASSIGNMENT_NOT_PRINTABLE');
    expect(await storage.exists(keyOf('1002'))).toBe(false);
    expect((await upload('1003', await testPdf())).status).toBe(201);
    const again = await upload('1003', await testPdf({ pages: [[612, 792]] }));
    expect(again.status).toBe(409);
    expect(errorOf(again).code).toBe('ASSIGNMENT_ALREADY_SIGNED');
    await setState(prisma, idOf('1001'), world.managerId, { status: 'cancelled' });
    expect(errorOf(await upload('1001', await testPdf())).code).toBe(
      'ASSIGNMENT_ALREADY_CANCELLED',
    );
  });

  it('logs one audit row: hash, size, pages, never the file name or anything personal', async () => {
    const scan = await testPdf({
      pages: [
        [595, 842],
        [595, 842],
        [595, 842],
      ],
    });
    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: world.emp['1001'] } });
    await upload('1001', scan, `${employee.firstName} ${employee.lastName}.pdf`);
    const rows = await audits('assignment.signed_manual');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityId: idOf('1001'), userId: world.managerId });
    expect(rows[0]?.details).toEqual({
      roundId: round.roundId,
      fromStatus: 'no_email',
      signMethod: 'manual',
      fileSha256: sha256(scan),
      fileSize: scan.length,
      pageCount: 3,
      fileReused: false,
      strayFileKeys: [],
    });
    const text = JSON.stringify(rows[0]?.details);
    for (const secret of [employee.firstName, employee.lastName, employee.idNumber]) {
      expect(text).not.toContain(secret);
    }
  });

  it('is manager only: officer 403, signed out 401, the file never read or stored', async () => {
    const officer = await upload('1001', await testPdf(), 'scan.pdf', world.officerCookie);
    expect(officer.status).toBe(403);
    expect((await upload('1001', await testPdf(), 'scan.pdf', null)).status).toBe(401);
    expect(await storage.exists(keyOf('1001'))).toBe(false);
    expect((await rowOf('1001')).status).toBe('no_email');
  });
});
