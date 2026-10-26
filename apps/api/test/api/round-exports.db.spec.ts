import { createHash } from 'node:crypto';
import { type ApiError, EXPORT_COLUMNS, todayInIsrael } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import yauzl from 'yauzl';
import { AppException } from '../../src/common/errors/app.exception.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { StorageAdapter } from '../../src/common/storage/storage.adapter.js';
import { RoundZipService } from '../../src/modules/tracking/round-zip.service.js';
import type { FieldSpec } from '../fixtures/contracts.js';
import { testPdf } from '../fixtures/pdf.js';
import { personOf, returnRow } from '../setup/approvals.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import {
  SIGN_FIELDS,
  signAs,
  type SigningRound,
  signingRound,
  validSubmit,
} from '../setup/signing.js';
import { clearQueueJobs } from '../setup/worker.js';

/**
 * Exports and file access (3.17): the status export to Excel, the ZIP of signed files and the
 * signed-document link. Made-up employees only.
 */

/** The 3.13 contract, with the address as a box the employee fills in (a system value). */
const EXPORT_FIELDS: FieldSpec[] = SIGN_FIELDS.map((field) =>
  field.fieldType === 'address'
    ? { fieldType: 'address', fillMode: 'employee', label: 'כתובת' }
    : field,
);
const TYPED_ADDRESS = 'רחוב הסוד 7';
const FORMULA_ANSWER = '=HYPERLINK("http://example.com")';
const DEPT_15 = '15 - ממלאות מקום ירושלים';

let app: INestApplication;
let prisma: PrismaService;
let storage: StorageAdapter;
let world: RoundsWorld;
let round: SigningRound;
const logLines: string[] = [];

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  storage = app.get(StorageAdapter);
});

/**
 * 1001 signed (a formula answer, the typed address), then moved to department 19 and renamed
 * "=cmd"; 1002 signed and returned for correction; 1003 scanned by the manager; 1004 signed with
 * a stray file already at her key (so her document is `-2.pdf`); 1005 not signed.
 */
beforeEach(async () => {
  world = await seedRoundsWorld(app, prisma);
  await clearQueueJobs(prisma);
  round = await signingRound(
    app,
    prisma,
    world,
    ['1001', '1002', '1003', '1004', '1005'],
    EXPORT_FIELDS,
  );
  const answers = (nickname: string) =>
    validSubmit({
      answers: {
        nickname,
        shift: 'בוקר',
        start: todayInIsrael(),
        agree: true,
        address: TYPED_ADDRESS,
      },
    });
  expect((await signAs(app, personOf(round, '1001'), answers(FORMULA_ANSWER))).status).toBe(201);
  expect((await signAs(app, personOf(round, '1002'), answers('דנה'))).status).toBe(201);
  await returnRow(app, world, idOf('1002'));
  const scan = await request(httpServer(app))
    .post(`/api/assignments/${idOf('1003')}/manual-sign`)
    .set('Cookie', world.managerCookie)
    .attach('file', await testPdf(), 'scan.pdf');
  expect(scan.status, JSON.stringify(scan.body)).toBe(201);
  await storage.upload(baseKeyOf('1004'), Buffer.from('%PDF-1.4 stray'), {
    contentType: 'application/pdf',
  });
  expect((await signAs(app, personOf(round, '1004'), answers('שירה'))).status).toBe(201);
  await prisma.employee.update({
    where: { id: world.emp['1001'] },
    data: { departmentId: world.dept[19], firstName: '=cmd', mobile: '050-7654321' },
  });
  await clearQueueJobs(prisma);
  logLines.length = 0;
  vi.restoreAllMocks();
  for (const level of ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation((...parts: unknown[]) => {
      logLines.push(parts.map(String).join(' '));
    });
  }
});

afterAll(async () => {
  vi.restoreAllMocks();
  await app.close();
});

function idOf(number: string): string {
  return personOf(round, number).assignmentId;
}

function baseKeyOf(number: string): string {
  return `rounds/${round.roundId}/15/${number}.pdf`;
}

/** A GET read as bytes (`null` = signed out). */
function getBytes(path: string, cookie: string | null) {
  const req = request(httpServer(app))
    .get(path)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
  if (cookie) req.set('Cookie', cookie);
  return req;
}

const errorCode = (response: request.Response) =>
  (JSON.parse((response.body as Buffer).toString('utf8')) as ApiError).error.code;

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

interface ZipEntry {
  name: string;
  utf8Flag: boolean;
  content: Buffer;
}

/** Every entry of a ZIP, with whether its UTF-8 flag (general purpose bit 11) is set. */
function readZip(zip: Buffer): Promise<ZipEntry[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zip, { lazyEntries: true }, (error, file) => {
      if (error) return reject(error);
      const entries: ZipEntry[] = [];
      file.on('error', reject);
      file.on('end', () => resolve(entries));
      file.on('entry', (entry: yauzl.Entry) => {
        file.openReadStream(entry, (openError, stream) => {
          if (openError) return reject(openError);
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => {
            entries.push({
              name: entry.fileName,
              utf8Flag: (entry.generalPurposeBitFlag & 0x800) !== 0,
              content: Buffer.concat(chunks),
            });
            file.readEntry();
          });
        });
      });
      file.readEntry();
    });
  });
}

/** The first sheet as rows of text (header first). */
async function readSheet(xlsx: Buffer): Promise<{ sheet: ExcelJS.Worksheet; rows: string[][] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsx as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('no sheet');
  const rows: string[][] = [];
  sheet.eachRow((row) => {
    const cells: string[] = [];
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      cells.push(row.getCell(column).text);
    }
    rows.push(cells);
  });
  return { sheet, rows };
}

/** All the text inside an xlsx (its XML parts). */
async function xlsxText(xlsx: Buffer): Promise<string> {
  return (await readZip(xlsx)).map(({ content }) => content.toString('utf8')).join('\n');
}

const column = (header: string) => EXPORT_COLUMNS.findIndex((c) => c.header === header);

describe('GET /api/rounds/:id/export', () => {
  const path = () => `/api/rounds/${round.roundId}/export`;

  it('sends a right-to-left sheet with one row per assignment, the 3.11 labels and dates', async () => {
    const response = await getBytes(path(), world.managerCookie);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(String(response.headers['content-disposition'])).toMatch(/^attachment; filename=/);
    expect(String(response.headers['content-disposition'])).toContain(
      encodeURIComponent(' - סטטוס.xlsx'),
    );
    const { sheet, rows } = await readSheet(response.body as Buffer);
    expect(sheet.views[0]).toMatchObject({ rightToLeft: true });
    const [header, ...body] = rows;
    expect(header?.slice(0, EXPORT_COLUMNS.length)).toEqual(EXPORT_COLUMNS.map((c) => c.header));
    expect(header?.slice(EXPORT_COLUMNS.length)).toEqual([
      'כתובת',
      'שם לתעודה',
      'הערות',
      'משמרת',
      'תאריך התחלה',
      'אני מסכימה',
      'ראשי תיבות',
    ]);
    expect(body).toHaveLength(5);
    const byNumber = new Map(body.map((row) => [row[0] ?? '', row]));
    const first = byNumber.get('1001') ?? [];
    // Department at send, even after the move to 19.
    expect(first[column('מחלקה')]).toBe(DEPT_15);
    expect(first[column('סטטוס')]).toBe('נחתם, ממתין לאישור');
    expect(first[column('אישור')]).toBe('ממתין לאישור');
    expect(first[column('נחתם')]).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(first[column('אופן חתימה')]).toBe('דיגיטלית');
    expect(first[column('קבלת עותק')]).toBe('מייל');
    expect(first[column('מייל שנמסר')]).toBe('dana.new@example.com');
    expect(first[column('שונה מהמייל במערכת')]).toBe('כן');
    const answers = first.slice(EXPORT_COLUMNS.length);
    expect(answers).toEqual([
      'מולא ע"י העובד',
      `'${FORMULA_ANSWER}`,
      '',
      'בוקר',
      todayInIsrael().split('-').reverse().join('/'),
      'כן',
      'צויר',
    ]);

    const returned = byNumber.get('1002') ?? [];
    expect(returned[column('סטטוס')]).toBe('הוחזר לתיקון');
    expect(returned[column('אישור')]).toBe('הוחזר לתיקון');
    expect(returned.slice(EXPORT_COLUMNS.length)[1]).toBe('דנה');

    const scanned = byNumber.get('1003') ?? [];
    expect(scanned[column('סטטוס')]).toBe('נחתם ידנית');
    expect(scanned[column('אופן חתימה')]).toBe('סריקה ידנית');
    expect(scanned[column('טופל ע"י')]).not.toBe('');
    expect(scanned.slice(EXPORT_COLUMNS.length).every((cell) => cell === '')).toBe(true);
    expect((byNumber.get('1005') ?? [])[column('סטטוס')]).toBe('נשלח');
  });

  it('neutralizes a name and a typed answer that start like a formula', async () => {
    const { rows } = await readSheet((await getBytes(path(), world.managerCookie)).body as Buffer);
    const first = rows.find((row) => row[0] === '1001') ?? [];
    expect(first[column('שם פרטי')]).toBe(`'=cmd`);
    expect(first).toContain(`'${FORMULA_ANSWER}`);
    expect(rows.flat().filter((cell) => /^[=+\-@\t\r]/.test(cell))).toEqual([]);
  });

  it('never holds the ID number, an address, a birth date or a phone', async () => {
    await prisma.employee.updateMany({ data: { birthDate: new Date('1990-05-17') } });
    const text = await xlsxText((await getBytes(path(), world.managerCookie)).body as Buffer);
    const people = await prisma.employee.findMany({
      where: { employeeNumber: { startsWith: '100' } },
    });
    for (const secret of [
      TYPED_ADDRESS,
      'הרב קוק 12',
      '050-7654321',
      '17/05/1990',
      '1990-05-17',
      ...people.map((p) => p.idNumber),
    ]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('uses the table filters and logs ids and counts only', async () => {
    const response = await getBytes(
      `${path()}?status=signed_manual&status=sent&dept=${world.dept[15]}`,
      world.officerCookie,
    );
    expect(response.status).toBe(200);
    const { rows } = await readSheet(response.body as Buffer);
    expect(
      rows
        .slice(1)
        .map((row) => row[0])
        .sort(),
    ).toEqual(['1003', '1005']);
    const returnedOnly = await readSheet(
      (await getBytes(`${path()}?returned=true`, world.managerCookie)).body as Buffer,
    );
    expect(returnedOnly.rows.slice(1).map((row) => row[0])).toEqual(['1002']);

    const [audit] = await prisma.auditLog.findMany({ where: { action: 'round.exported' } });
    expect(audit).toMatchObject({ entityType: 'round', entityId: round.roundId });
    expect(audit?.details).toEqual({
      statuses: ['signed_manual', 'sent'],
      departmentId: world.dept[15],
      rowCount: 2,
      answerColumnCount: 7,
    });
  });

  it('lists a correction round as its own document', async () => {
    const sent = await request(httpServer(app))
      .post(`/api/assignments/${idOf('1002')}/send-again`)
      .set('Cookie', world.managerCookie);
    expect(sent.status).toBe(201);
    const correctionId = (sent.body as { roundId: string }).roundId;
    const original = await readSheet((await getBytes(path(), world.managerCookie)).body as Buffer);
    const returned = original.rows.find((row) => row[0] === '1002') ?? [];
    expect(returned[column('נשלח שוב בסבב')]).toMatch(/^תיקון: /);
    const correction = await readSheet(
      (await getBytes(`/api/rounds/${correctionId}/export`, world.managerCookie)).body as Buffer,
    );
    expect(correction.rows.slice(1).map((row) => [row[0], row[column('סטטוס')]])).toEqual([
      ['1002', 'ממתין לשליחה'],
    ]);
  });

  it('refuses search text, a signed-out reader and an unknown round', async () => {
    expect(errorCode(await getBytes(`${path()}?q=1001`, world.managerCookie))).toBe(
      'VALIDATION_FAILED',
    );
    expect((await getBytes(`${path()}?page=1`, world.managerCookie)).status).toBe(400);
    expect((await getBytes(path(), null)).status).toBe(401);
    const unknown = await getBytes(
      '/api/rounds/7b0c1f7e-3a52-4d41-9a1e-1c2b3d4e5f60/export',
      world.managerCookie,
    );
    expect(unknown.status).toBe(404);
    expect(errorCode(unknown)).toBe('ROUND_NOT_FOUND');
    expect((await getBytes('/api/rounds/nope/export', world.managerCookie)).status).toBe(400);
  });
});

describe('GET /api/rounds/:id/download', () => {
  const path = () => `/api/rounds/${round.roundId}/download`;

  it('streams the signed files in department-at-send folders with UTF-8 Hebrew names', async () => {
    const response = await getBytes(path(), world.officerCookie);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/zip');
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename=/);
    const entries = await readZip(response.body as Buffer);
    const people = await prisma.employee.findMany({
      where: { employeeNumber: { in: ['1001', '1003', '1004'] } },
    });
    const nameOf = (number: string) => {
      const p = people.find((e) => e.employeeNumber === number);
      return `${number}_${p?.firstName ?? ''} ${p?.lastName ?? ''}`.replace(/[<>:"/\\|?*]/g, '_');
    };
    // 1001 moved to 19 after signing: still in the 15 folder. 1002 was returned: not here.
    expect(entries.map(({ name }) => name).sort()).toEqual(
      ['1001', '1003', '1004'].map((number) => `${DEPT_15}/${nameOf(number)}.pdf`).sort(),
    );
    expect(entries.every(({ utf8Flag }) => utf8Flag)).toBe(true);

    for (const number of ['1001', '1003', '1004']) {
      const row = await prisma.assignment.findUniqueOrThrow({ where: { id: idOf(number) } });
      const entry = entries.find(({ name }) => name.includes(`/${number}_`));
      expect(sha256(entry?.content ?? Buffer.alloc(0))).toBe(row.signedFileSha256);
    }
    // 1004's document is at -2.pdf; the stray file at her first key is never sent.
    const fourth = await prisma.assignment.findUniqueOrThrow({ where: { id: idOf('1004') } });
    expect(fourth.signedFileKey).toBe(baseKeyOf('1004').replace(/\.pdf$/, '-2.pdf'));
    expect(entries.some(({ content }) => content.toString().includes('stray'))).toBe(false);
    expect(entries.some(({ name }) => name.endsWith('.png'))).toBe(false);

    const [audit] = await prisma.auditLog.findMany({ where: { action: 'round.files_downloaded' } });
    expect(audit).toMatchObject({ entityType: 'round', entityId: round.roundId });
    expect(audit?.details).toEqual({
      departmentId: null,
      fileCount: 3,
      missingCount: 0,
      missingAssignmentIds: [],
      completed: true,
    });
  });

  it('filters by department at send', async () => {
    expect((await getBytes(`${path()}?dept=${world.dept[15]}`, world.managerCookie)).status).toBe(
      200,
    );
    const other = await getBytes(`${path()}?dept=${world.dept[19]}`, world.managerCookie);
    expect(other.status).toBe(409);
    expect(errorCode(other)).toBe('ROUND_HAS_NO_SIGNED_FILES');
  });

  it('skips a file missing in storage and lists it in a Hebrew note', async () => {
    await prisma.assignment.update({
      where: { id: idOf('1003') },
      data: { signedFileKey: `rounds/${round.roundId}/15/missing.pdf` },
    });
    const entries = await readZip((await getBytes(path(), world.managerCookie)).body as Buffer);
    expect(entries.map(({ name }) => name)).toHaveLength(3);
    const note = entries.find(({ name }) => name === 'קבצים חסרים.txt');
    expect(note?.content.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(note?.content.toString('utf8')).toContain(`${DEPT_15} | 1003 |`);
    expect(entries.some(({ name }) => name.includes('/1003_'))).toBe(false);
    const [audit] = await prisma.auditLog.findMany({ where: { action: 'round.files_downloaded' } });
    expect(audit?.details).toMatchObject({
      fileCount: 2,
      missingCount: 1,
      missingAssignmentIds: [idOf('1003')],
      completed: true,
    });
  });

  it('allows one ZIP at a time per user', async () => {
    const zips = app.get(RoundZipService);
    const actor = { userId: world.managerId, ip: null };
    const first = await zips.open(round.roundId, {}, actor);
    const second = zips.open(round.roundId, {}, actor);
    await expect(second).rejects.toBeInstanceOf(AppException);
    await expect(second).rejects.toMatchObject({ code: 'DOWNLOAD_IN_PROGRESS' });
    const { PassThrough } = await import('node:stream');
    const sink = new PassThrough();
    sink.resume();
    await first.pipeTo(sink);
    await (await zips.open(round.roundId, {}, actor)).pipeTo(new PassThrough().resume());
  });

  it('answers 401, 404 and 400', async () => {
    expect((await getBytes(path(), null)).status).toBe(401);
    const unknown = await getBytes(
      '/api/rounds/7b0c1f7e-3a52-4d41-9a1e-1c2b3d4e5f60/download',
      world.managerCookie,
    );
    expect(errorCode(unknown)).toBe('ROUND_NOT_FOUND');
    expect((await getBytes(`${path()}?q=x`, world.managerCookie)).status).toBe(400);
  });
});

describe('GET /api/assignments/:id/document', () => {
  const get = (id: string, cookie: string | null) => {
    const req = request(httpServer(app)).get(`/api/assignments/${id}/document`).redirects(0);
    if (cookie) req.set('Cookie', cookie);
    return req;
  };

  it('redirects to a 5-minute link with the Hebrew name and logs the view', async () => {
    for (const cookie of [world.managerCookie, world.officerCookie]) {
      const response = await get(idOf('1004'), cookie);
      expect(response.status).toBe(302);
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      const link = new URL(String(response.headers.location));
      expect(Number(link.searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(300);
      expect(link.searchParams.get('response-content-disposition')).toContain(
        "filename*=UTF-8''" + encodeURIComponent('הצהרת עובדת - '),
      );
      const file = await fetch(link);
      expect(file.status).toBe(200);
      const row = await prisma.assignment.findUniqueOrThrow({ where: { id: idOf('1004') } });
      expect(sha256(Buffer.from(await file.arrayBuffer()))).toBe(row.signedFileSha256);
    }
    const audits = await prisma.auditLog.findMany({ where: { action: 'document.view' } });
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({ entityType: 'assignment', entityId: idOf('1004') });
    expect(audits[0]?.details).toEqual({
      roundId: round.roundId,
      status: 'signed',
      signMethod: 'digital',
    });
  });

  it('opens a returned document (proof) and a scan', async () => {
    expect((await get(idOf('1002'), world.managerCookie)).status).toBe(302);
    expect((await get(idOf('1003'), world.managerCookie)).status).toBe(302);
  });

  it('answers 409 without a signed file, 404 unknown or lost, 401 and 400', async () => {
    const unsigned = await get(idOf('1005'), world.managerCookie);
    expect(unsigned.status).toBe(409);
    expect((unsigned.body as ApiError).error).toMatchObject({
      code: 'DOCUMENT_NOT_SIGNED',
      details: { status: 'sent' },
    });
    const unknown = await get('7b0c1f7e-3a52-4d41-9a1e-1c2b3d4e5f60', world.managerCookie);
    expect((unknown.body as ApiError).error.code).toBe('ASSIGNMENT_NOT_FOUND');
    await prisma.assignment.update({
      where: { id: idOf('1003') },
      data: { signedFileKey: `rounds/${round.roundId}/15/missing.pdf` },
    });
    const lost = await get(idOf('1003'), world.managerCookie);
    expect(lost.status).toBe(404);
    expect((lost.body as ApiError).error.code).toBe('SIGNED_FILE_NOT_FOUND');
    expect((await get(idOf('1004'), null)).status).toBe(401);
    expect((await get('nope', world.managerCookie)).status).toBe(400);
    expect(await prisma.auditLog.count({ where: { action: 'document.view' } })).toBe(0);
  });
});

describe('privacy', () => {
  it('keeps names, addresses, ID numbers and answers out of audit rows and logs', async () => {
    await getBytes(`/api/rounds/${round.roundId}/export`, world.managerCookie);
    await getBytes(`/api/rounds/${round.roundId}/download`, world.managerCookie);
    await request(httpServer(app))
      .get(`/api/assignments/${idOf('1001')}/document`)
      .redirects(0)
      .set('Cookie', world.managerCookie);
    const people = await prisma.employee.findMany({
      where: { employeeNumber: { in: ['1001', '1002', '1003', '1004', '1005'] } },
    });
    const secrets = [
      TYPED_ADDRESS,
      FORMULA_ANSWER,
      'dana.new@example.com',
      'שירה',
      ...people.flatMap((p) => [p.idNumber, p.firstName, p.lastName, p.email ?? '']),
    ].filter((secret) => secret !== '');
    const audits = await prisma.auditLog.findMany({
      where: { action: { in: ['round.exported', 'round.files_downloaded', 'document.view'] } },
    });
    expect(audits).toHaveLength(3);
    const text = [...audits.map(({ details }) => JSON.stringify(details)), ...logLines].join('\n');
    for (const secret of secrets) expect(text, secret).not.toContain(secret);
  });
});
