import {
  type ApiError,
  IMPORT_ISSUE_MESSAGES as M,
  IMPORT_MAX_ROWS,
  type ImportPreview,
  importPreviewSchema,
} from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runSeed } from '../../prisma/run-seed.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { StorageAdapter } from '../../src/common/storage/storage.adapter.js';
import { SAMPLE_ROWS } from '../fixtures/har-gal-sample.js';
import { FIXTURE_HEADERS, type FixtureRow, harGalXlsx } from '../fixtures/har-gal-workbook.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { resetDatabase } from '../setup/database.js';

const seedPassword = 'test-seed-password';
const manager = 'manager@doc-signing.local';
const officer = 'officer@doc-signing.local';
const fileName = 'עובדים הר גל.xlsx';

let app: INestApplication;
let prisma: PrismaService;
let managerCookie: string;
let officerCookie: string;
let sample: Buffer;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  sample = await harGalXlsx(SAMPLE_ROWS);
});

beforeEach(async () => {
  await resetDatabase(prisma);
  await runSeed(prisma, { password: seedPassword });
  managerCookie = await cookieFor(manager);
  officerCookie = await cookieFor(officer);
  // The state the sample expects: two bounced emails and one manual phone edit.
  await prisma.employee.updateMany({
    where: { employeeNumber: { in: ['1002', '1003'] } },
    data: { emailStatus: 'bounced' },
  });
  await prisma.employee.update({
    where: { employeeNumber: '1004' },
    data: { phone: '050-7654321' },
  });
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

/** `cookie: null` = signed out. */
function upload(bytes: Buffer, name = fileName, cookie: string | null = managerCookie) {
  const req = request(httpServer(app)).post('/api/employees/import/preview');
  if (cookie) req.set('Cookie', cookie);
  return req.attach('file', bytes, name);
}

const errorOf = (response: request.Response) => (response.body as ApiError).error;
const previewOf = (response: request.Response) => response.body as ImportPreview;

/** Everything the import must not touch, to compare before and after. */
async function snapshot() {
  const [employees, departments] = await Promise.all([
    prisma.employee.findMany({ orderBy: { employeeNumber: 'asc' } }),
    prisma.department.findMany({ orderBy: { code: 'asc' } }),
  ]);
  return { employees, departments };
}

describe('POST /api/employees/import/preview: the planted file', () => {
  it('gives exact counts, changes and reasons, and changes no employee or department', async () => {
    const before = await snapshot();
    const response = await upload(sample);
    expect(response.status).toBe(201);
    const preview = importPreviewSchema.parse(response.body);

    expect(preview.fileName).toBe(fileName);
    expect(preview.counts).toEqual({
      rowsTotal: 17,
      rowsNew: 3,
      rowsUpdated: 2,
      rowsUnchanged: 2,
      rowsFailed: 10,
      departmentsNew: 1,
      departmentsRenamed: 1,
    });
    expect(preview.newEmployees).toEqual([
      {
        row: 2,
        employeeNumber: '2001',
        fullName: 'נועה לוי',
        department: '45 - ממלאות מקום אלעד-45',
        emailStatus: 'valid',
      },
      {
        row: 3,
        employeeNumber: '2002',
        fullName: 'יוסף מזרחי',
        department: '15 - ממלאות מקום ירושלים',
        emailStatus: 'missing',
      },
      {
        row: 9,
        employeeNumber: '2003',
        fullName: 'אסתר פרץ',
        department: '61 - ממלאות מקום אלעד-61',
        emailStatus: 'invalid',
      },
    ]);
    expect(preview.updatedEmployees).toEqual([
      {
        row: 5,
        employeeNumber: '1002',
        fullName: 'שרה כהן-לוי 2',
        changes: [
          'email: e1002@example.com → sarah.new@example.com',
          'emailStatus: bounced → valid',
        ],
      },
      {
        row: 7,
        employeeNumber: '1004',
        fullName: 'רבקה בן-דוד 3',
        changes: ['departmentCode: 15 → 19', 'phone: 050-7654321 → (none)'],
      },
    ]);
    expect(preview.newDepartments).toEqual([{ code: 45, name: 'ממלאות מקום אלעד-45' }]);
    expect(preview.renamedDepartments).toEqual([
      { code: 19, from: 'ממ חינוך מיוחד', to: 'ממ חינוך מיוחד חדש' },
    ]);
    expect(preview.errors).toEqual([
      {
        row: 10,
        employeeNumber: '2004',
        code: 'ID_NUMBER_INVALID',
        message: M.ID_NUMBER_INVALID(),
      },
      {
        row: 11,
        employeeNumber: '2005',
        code: 'DUPLICATE_EMPLOYEE_NUMBER',
        message: M.DUPLICATE_EMPLOYEE_NUMBER([12]),
      },
      {
        row: 12,
        employeeNumber: '2005',
        code: 'DUPLICATE_EMPLOYEE_NUMBER',
        message: M.DUPLICATE_EMPLOYEE_NUMBER([11]),
      },
      {
        row: 13,
        employeeNumber: '2006',
        code: 'DUPLICATE_ID_NUMBER',
        message: M.DUPLICATE_ID_NUMBER([14]),
      },
      {
        row: 14,
        employeeNumber: '2007',
        code: 'DUPLICATE_ID_NUMBER',
        message: M.DUPLICATE_ID_NUMBER([13]),
      },
      {
        row: 15,
        employeeNumber: '2008',
        code: 'DEPARTMENT_INVALID',
        message: M.DEPARTMENT_INVALID(),
      },
      {
        row: 16,
        employeeNumber: '2009',
        code: 'DEPARTMENT_NAME_CONFLICT',
        message: M.DEPARTMENT_NAME_CONFLICT(70, ['מחלקה א', 'מחלקה ב']),
      },
      {
        row: 17,
        employeeNumber: '2010',
        code: 'DEPARTMENT_NAME_CONFLICT',
        message: M.DEPARTMENT_NAME_CONFLICT(70, ['מחלקה א', 'מחלקה ב']),
      },
      {
        row: 18,
        employeeNumber: '2011',
        code: 'ID_NUMBER_TAKEN',
        message: M.ID_NUMBER_TAKEN('1005'),
      },
      {
        row: 19,
        employeeNumber: '2012',
        code: 'FIRST_NAME_MISSING',
        message: M.FIRST_NAME_MISSING(),
      },
    ]);
    expect(preview.warnings).toEqual([
      { row: 9, employeeNumber: '2003', code: 'EMAIL_INVALID', message: M.EMAIL_INVALID() },
      { row: 9, employeeNumber: '2003', code: 'PHONE_INVALID', message: M.PHONE_INVALID() },
    ]);

    expect(await snapshot()).toEqual(before);
  });

  it('saves one preview batch, the original file and one log row, without ID numbers', async () => {
    const preview = previewOf(await upload(sample));
    const user = await prisma.user.findUniqueOrThrow({ where: { email: manager } });

    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: preview.batchId } });
    expect(batch).toMatchObject({
      uploadedById: user.id,
      fileName,
      fileKey: `imports/${preview.batchId}.xlsx`,
      status: 'preview',
      rowsTotal: 17,
      rowsCreated: 3,
      rowsUpdated: 2,
      rowsUnchanged: 2,
      rowsFailed: 10,
      committedAt: null,
    });
    expect(batch.errors).toEqual(preview.errors);

    const stored = await app.get(StorageAdapter).download(batch.fileKey);
    expect(stored.equals(sample)).toBe(true);

    const logs = await prisma.auditLog.findMany({ where: { action: 'import.preview' } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      userId: user.id,
      entityType: 'import_batch',
      entityId: preview.batchId,
      details: {
        fileName,
        rowsTotal: 17,
        rowsNew: 3,
        rowsUpdated: 2,
        rowsUnchanged: 2,
        rowsFailed: 10,
        departmentsNew: 1,
        departmentsRenamed: 1,
      },
    });

    // No ID number of the file (with or without its leading 0) in the response, batch or log.
    const ids = SAMPLE_ROWS.flatMap((row) => {
      const id = row?.idNumber;
      return typeof id === 'number' || typeof id === 'string' ? [String(id)] : [];
    });
    expect(ids).toHaveLength(17);
    const saved = JSON.stringify([preview, batch, logs], (_key, value: unknown) =>
      typeof value === 'bigint' ? String(value) : value,
    );
    for (const id of ids) {
      expect(saved).not.toContain(id.padStart(9, '0'));
      expect(saved).not.toMatch(new RegExp(`(?<!\\d)${id}(?!\\d)`));
    }
  });

  it('gives each upload its own batch and file; a second upload never overwrites', async () => {
    const first = previewOf(await upload(sample));
    const second = previewOf(await upload(sample));
    expect(second.batchId).not.toBe(first.batchId);
    expect(await prisma.importBatch.count()).toBe(2);
  });
});

describe('access', () => {
  it('refuses a signed-out user with 401', async () => {
    const response = await upload(sample, fileName, null);
    expect(response.status).toBe(401);
    expect(errorOf(response).code).toBe('UNAUTHORIZED');
  });

  it('refuses an officer with 403', async () => {
    const response = await upload(sample, fileName, officerCookie);
    expect(response.status).toBe(403);
    expect(errorOf(response).code).toBe('FORBIDDEN');
    expect(await prisma.importBatch.count()).toBe(0);
  });
});

describe('refused files: 400 in Hebrew, nothing saved', () => {
  async function expectRefused(response: request.Response, code: string) {
    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe(code);
    expect(errorOf(response).message).toMatch(/\p{Script=Hebrew}/u);
    expect(await prisma.importBatch.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'import.preview' } })).toBe(0);
  }

  it('no file', async () => {
    const response = await request(httpServer(app))
      .post('/api/employees/import/preview')
      .set('Cookie', managerCookie)
      .send({});
    await expectRefused(response, 'FILE_REQUIRED');
  });

  it('a file under another form field', async () => {
    const response = await request(httpServer(app))
      .post('/api/employees/import/preview')
      .set('Cookie', managerCookie)
      .attach('document', sample, fileName);
    await expectRefused(response, 'FILE_REQUIRED');
  });

  it('a PDF named .xlsx', async () => {
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
    await expectRefused(await upload(pdf, 'employees.xlsx'), 'INVALID_EXCEL_FILE');
  });

  it('a cut-off .xlsx', async () => {
    const broken = sample.subarray(0, Math.floor(sample.length / 2));
    await expectRefused(await upload(broken), 'INVALID_EXCEL_FILE');
  });

  it('a file over 5 MB', async () => {
    const huge = Buffer.concat([sample, Buffer.alloc(6 * 1024 * 1024, 1)]);
    await expectRefused(await upload(huge), 'FILE_TOO_LARGE');
  });

  it('a missing header, named in the details', async () => {
    const headers = FIXTURE_HEADERS.filter((header) => header !== 'תעודת זהות');
    const response = await upload(await harGalXlsx(SAMPLE_ROWS, { headers }));
    await expectRefused(response, 'IMPORT_MISSING_COLUMNS');
    expect(errorOf(response).details).toEqual({ columns: ['תעודת זהות'] });
  });

  it(`more than ${IMPORT_MAX_ROWS} rows`, async () => {
    const row: FixtureRow = {
      employeeNumber: 9001,
      idNumber: 55500003,
      firstName: 'א',
      lastName: 'ב',
      department: '15 - x',
    };
    const response = await upload(
      await harGalXlsx(Array.from({ length: IMPORT_MAX_ROWS + 1 }, () => row)),
    );
    await expectRefused(response, 'IMPORT_TOO_MANY_ROWS');
  }, 30_000);
});
