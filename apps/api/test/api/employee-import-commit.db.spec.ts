import {
  type ApiError,
  type ImportCommitResult,
  importCommitResultSchema,
  type ImportPreview,
  isValidIdNumber,
} from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSeed } from '../../prisma/run-seed.js';
import { EmailAdapter } from '../../src/common/email/email.adapter.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { QUEUE_SCHEMA } from '../../src/common/queue/queue.definitions.js';
import { StorageAdapter } from '../../src/common/storage/storage.adapter.js';
import { StorageNotFoundError } from '../../src/common/storage/storage.errors.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { ImportRepository } from '../../src/modules/employees/import/import.repository.js';
import { SAMPLE_ROWS } from '../fixtures/har-gal-sample.js';
import {
  FIXTURE_EXTRA_HEADERS,
  FIXTURE_HEADERS,
  type FixtureRow,
  harGalXlsx,
} from '../fixtures/har-gal-workbook.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { resetDatabase } from '../setup/database.js';
import { clearQueueJobs } from '../setup/worker.js';

const seedPassword = 'test-seed-password';
const manager = 'manager@doc-signing.local';
const officer = 'officer@doc-signing.local';
const fileName = 'עובדים הר גל.xlsx';
const DAY = 24 * 60 * 60 * 1000;

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
  await clearQueueJobs(prisma);
  await runSeed(prisma, { password: seedPassword });
  managerCookie = await cookieFor(manager);
  officerCookie = await cookieFor(officer);
  // The state the sample expects (as in the preview test): two bounced emails, one manual mobile.
  await prisma.employee.updateMany({
    where: { employeeNumber: { in: ['1002', '1003'] } },
    data: { emailStatus: 'bounced' },
  });
  await prisma.employee.update({
    where: { employeeNumber: '1004' },
    data: { mobile: '050-7654321' },
  });
});

afterEach(() => {
  vi.useRealTimers();
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
  const line = lines.find((value) => value.startsWith('sid=')) ?? '';
  return line.split(';')[0] ?? '';
}

async function preview(bytes: Buffer = sample): Promise<ImportPreview> {
  const response = await request(httpServer(app))
    .post('/api/employees/import/preview')
    .set('Cookie', managerCookie)
    .attach('file', bytes, fileName);
  expect(response.status).toBe(201);
  return response.body as ImportPreview;
}

/** `cookie: null` = signed out. */
function commit(batchId: string, cookie: string | null = managerCookie) {
  const req = request(httpServer(app)).post(`/api/employees/import/${batchId}/commit`);
  if (cookie) req.set('Cookie', cookie);
  return req.send();
}

const errorOf = (response: request.Response) => (response.body as ApiError).error;

function expectRefused(response: request.Response, status: number, code: string): void {
  expect(response.status).toBe(status);
  expect(errorOf(response).code).toBe(code);
  expect(errorOf(response).message).toMatch(/\p{Script=Hebrew}/u);
}

/** Every employee and department, to compare before and after. */
async function snapshot() {
  const [employees, departments] = await Promise.all([
    prisma.employee.findMany({ orderBy: { employeeNumber: 'asc' } }),
    prisma.department.findMany({ orderBy: { code: 'asc' } }),
  ]);
  return { employees, departments };
}

const employee = (employeeNumber: string) =>
  prisma.employee.findUniqueOrThrow({
    where: { employeeNumber },
    include: { department: { select: { code: true, name: true } } },
  });

/**
 * Pretends the preview was made `hours` ago: moves the batch and every employee and department
 * back by that much (so none looks changed after the preview), with the triggers off (they
 * keep created_at fixed and stamp updated_at).
 */
async function ageBatch(batchId: string, hours: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
    await tx.$executeRaw`
      UPDATE import_batches SET created_at = created_at - make_interval(hours => ${hours}::int)
      WHERE id = ${batchId}::uuid`;
    for (const table of ['employees', 'departments']) {
      await tx.$executeRawUnsafe(
        `UPDATE ${table} SET created_at = created_at - make_interval(hours => $1::int),
                             updated_at = updated_at - make_interval(hours => $1::int)`,
        hours,
      );
    }
  });
}

async function batchStatus(batchId: string) {
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  return batch.status;
}

async function queuedJobs(): Promise<number> {
  const [row] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT count(*) AS count FROM "${QUEUE_SCHEMA}".job`,
  );
  return Number(row?.count ?? 0);
}

describe('POST /api/employees/import/:batchId/commit: the planted file', () => {
  it('applies exactly what the preview showed', async () => {
    const before = await snapshot();
    const shown = await preview();
    const response = await commit(shown.batchId);
    expect(response.status).toBe(201);
    const result = importCommitResultSchema.parse(response.body);
    expect(result).toMatchObject({ batchId: shown.batchId, status: 'committed' });
    expect(result.counts).toEqual(shown.counts);

    // New employees, as listed; warnings imported (bad email → invalid, bad mobile → empty).
    expect(await employee('2001')).toMatchObject({
      idNumber: '055500003',
      firstName: 'נועה',
      lastName: 'לוי',
      department: { code: 45, name: 'ממלאות מקום אלעד-45' },
      email: 'noa.levi@example.com',
      emailStatus: 'valid',
      landline: null,
      mobile: '050-1234567',
      isActive: true,
      lastImportId: shown.batchId,
    });
    expect(await employee('2002')).toMatchObject({
      email: null,
      emailStatus: 'missing',
      landline: '02-6234567',
      mobile: null,
      department: { code: 15 },
    });
    expect(await employee('2003')).toMatchObject({
      email: 'esther@@example',
      emailStatus: 'invalid',
      mobile: null,
      department: { code: 61 },
    });

    // Updated: a new email clears bounced; Har Gal overwrites the manual mobile; renamed department.
    expect(await employee('1002')).toMatchObject({
      email: 'sarah.new@example.com',
      emailStatus: 'valid',
      lastImportId: shown.batchId,
    });
    expect(await employee('1004')).toMatchObject({
      department: { code: 19, name: 'ממ חינוך מיוחד חדש' },
      mobile: null,
      lastImportId: shown.batchId,
    });

    // Unchanged rows (1001, 1003: same email stays bounced) and employees missing from the file
    // are exactly as before, updated_at included.
    const after = await snapshot();
    const untouched = ['1001', '1003', '1005', '1006', '1007'];
    for (const number of untouched) {
      const row = after.employees.find((e) => e.employeeNumber === number);
      expect(row).toEqual(before.employees.find((e) => e.employeeNumber === number));
    }
    expect((await employee('1003')).emailStatus).toBe('bounced');
    const notInFile = before.employees.filter((e) => !untouched.includes(e.employeeNumber));
    for (const row of notInFile.filter((e) => !['1002', '1004'].includes(e.employeeNumber))) {
      expect(after.employees.find((e) => e.id === row.id)).toEqual(row);
    }

    // Error rows are not imported.
    const failedNumbers = ['2004', '2005', '2006', '2007', '2008', '2009', '2010', '2011', '2012'];
    expect(await prisma.employee.count({ where: { employeeNumber: { in: failedNumbers } } })).toBe(
      0,
    );
    expect(after.employees).toHaveLength(before.employees.length + 3);
    expect(after.departments.map((d) => d.code)).toEqual([15, 19, 45, 61]);

    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: shown.batchId } });
    expect(batch).toMatchObject({
      status: 'committed',
      rowsTotal: 17,
      rowsCreated: 3,
      rowsUpdated: 2,
      rowsUnchanged: 2,
      rowsFailed: 10,
    });
    expect(batch.committedAt?.toISOString()).toBe(result.committedAt);
  });

  it('logs the commit and each changed employee, without ID numbers', async () => {
    const shown = await preview();
    expect((await commit(shown.batchId)).status).toBe(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: manager } });

    const commits = await prisma.auditLog.findMany({ where: { action: 'import.commit' } });
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      userId: user.id,
      entityType: 'import_batch',
      entityId: shown.batchId,
      details: {
        fileName,
        ...shown.counts,
        newDepartments: [{ code: 45, name: 'ממלאות מקום אלעד-45' }],
        renamedDepartments: [{ code: 19, from: 'ממ חינוך מיוחד', to: 'ממ חינוך מיוחד חדש' }],
      },
    });

    const created = await prisma.auditLog.findMany({
      where: { action: 'employee.created' },
      orderBy: { id: 'asc' },
    });
    expect(
      created.map((row) => (row.details as { employeeNumber: string }).employeeNumber),
    ).toEqual(['2001', '2002', '2003']);
    const e2001 = await employee('2001');
    expect(created[0]).toMatchObject({
      userId: user.id,
      entityType: 'employee',
      entityId: e2001.id,
      details: {
        employeeNumber: '2001',
        fullName: 'נועה לוי',
        departmentCode: 45,
        emailStatus: 'valid',
        importBatchId: shown.batchId,
      },
    });

    const updated = await prisma.auditLog.findMany({
      where: { action: 'employee.updated' },
      orderBy: { id: 'asc' },
    });
    expect(updated.map((row) => row.entityId)).toEqual([
      (await employee('1002')).id,
      (await employee('1004')).id,
    ]);
    expect(updated.map((row) => row.details)).toEqual(
      shown.updatedEmployees.map(({ changes }) => ({ changes, importBatchId: shown.batchId })),
    );

    const ids = (await prisma.employee.findMany({ select: { idNumber: true } })).map(
      (row) => row.idNumber,
    );
    const saved = JSON.stringify(await prisma.auditLog.findMany({ select: { details: true } }));
    for (const id of ids) {
      expect(saved).not.toContain(id);
      expect(saved).not.toContain(id.replace(/^0+/, ''));
    }
  });
});

describe('running the same import twice', () => {
  it('changes nothing the second time; the same batch again gets 409', async () => {
    const first = await preview();
    expect((await commit(first.batchId)).status).toBe(201);
    const afterFirst = await snapshot();

    expectRefused(await commit(first.batchId), 409, 'IMPORT_ALREADY_DONE');

    const second = await preview();
    expect(second.counts).toEqual({
      rowsTotal: 17,
      rowsNew: 0,
      rowsUpdated: 0,
      rowsUnchanged: 7,
      rowsFailed: 10,
      departmentsNew: 0,
      departmentsRenamed: 0,
    });
    expect(second.newEmployees).toEqual([]);
    expect(second.updatedEmployees).toEqual([]);
    expect((await commit(second.batchId)).status).toBe(201);

    expect(await snapshot()).toEqual(afterFirst);
    expect(await prisma.auditLog.count({ where: { action: 'employee.updated' } })).toBe(2);
  });

  it('two confirms of one batch at the same moment: one applies, the other gets 409', async () => {
    const shown = await preview();
    const responses = await Promise.all([commit(shown.batchId), commit(shown.batchId)]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const refused = responses.find((r) => r.status === 409);
    expect(refused && errorOf(refused).code).toBe('IMPORT_ALREADY_DONE');
    expect(await prisma.employee.count({ where: { employeeNumber: '2001' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'import.commit' } })).toBe(1);
  });

  it('never changes isActive: an inactive employee in the file stays inactive', async () => {
    await prisma.employee.update({ where: { employeeNumber: '1002' }, data: { isActive: false } });
    const shown = await preview();
    expect((await commit(shown.batchId)).status).toBe(201);
    expect(await employee('1002')).toMatchObject({
      isActive: false,
      email: 'sarah.new@example.com',
    });
  });
});

describe('stale previews: 409 IMPORT_STALE, nothing written, batch failed', () => {
  async function expectStale(batchId: string, before: Awaited<ReturnType<typeof snapshot>>) {
    expectRefused(await commit(batchId), 409, 'IMPORT_STALE');
    expect(await snapshot()).toEqual(before);
    expect(await batchStatus(batchId)).toBe('failed');
    const logs = await prisma.auditLog.findMany({ where: { action: 'import.failed' } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ entityId: batchId, details: { fileName, reason: 'stale' } });
    expect(await prisma.auditLog.count({ where: { action: 'import.commit' } })).toBe(0);
    // Failed for good: a later confirm is refused without another try.
    expectRefused(await commit(batchId), 409, 'IMPORT_ALREADY_DONE');
  }

  it('an employee of the file edited after the preview (by the API)', async () => {
    const shown = await preview();
    const target = await employee('1001');
    const edit = await request(httpServer(app))
      .patch(`/api/employees/${target.id}`)
      .set('Cookie', managerCookie)
      .send({ mobile: '050-1112223' });
    expect(edit.status).toBe(200);
    await expectStale(shown.batchId, await snapshot());
  });

  it('an employee matched only by an ID number of the file', async () => {
    // Row 18 carries 1005's ID under another employee number (an error row), yet 1005 is touched.
    const shown = await preview();
    await prisma.employee.update({
      where: { employeeNumber: '1005' },
      data: { lastName: 'שינוי' },
    });
    await expectStale(shown.batchId, await snapshot());
  });

  it('an employee created after the preview with a number of the file', async () => {
    const shown = await preview();
    const department = await prisma.department.findUniqueOrThrow({ where: { code: 15 } });
    await prisma.employee.create({
      data: {
        employeeNumber: '2001',
        idNumber: '055500003',
        firstName: 'נועה',
        lastName: 'לוי',
        departmentId: department.id,
        emailStatus: 'missing',
      },
    });
    await expectStale(shown.batchId, await snapshot());
  });

  it('a department of the file renamed after the preview', async () => {
    const shown = await preview();
    await prisma.department.update({ where: { code: 61 }, data: { name: 'שם אחר' } });
    await expectStale(shown.batchId, await snapshot());
  });

  it('a change to an employee not in the file does not block the confirm', async () => {
    const shown = await preview();
    await prisma.employee.update({ where: { employeeNumber: '1006' }, data: { lastName: 'אחר' } });
    await prisma.department.create({ data: { code: 99, name: 'מחלקה חדשה' } });
    expect((await commit(shown.batchId)).status).toBe(201);
  });
});

describe('a confirm that fails halfway rolls back fully', () => {
  it('an unexpected error: nothing written, batch stays preview, a retry applies it', async () => {
    const shown = await preview();
    const before = await snapshot();
    // Fails after the departments were saved in the same transaction.
    vi.spyOn(app.get(ImportRepository), 'updateEmployees').mockRejectedValueOnce(
      new Error('database went away'),
    );
    expectRefused(await commit(shown.batchId), 500, 'INTERNAL_ERROR');
    expect(await snapshot()).toEqual(before);
    expect(await batchStatus(shown.batchId)).toBe('preview');
    const commitLogs = ['import.commit', 'import.failed', 'employee.created', 'employee.updated'];
    expect(await prisma.auditLog.count({ where: { action: { in: commitLogs } } })).toBe(0);

    expect((await commit(shown.batchId)).status).toBe(201);
    expect(await batchStatus(shown.batchId)).toBe('committed');
  });

  it('a unique index refusing a write (saved at the same moment) → 409 IMPORT_STALE', async () => {
    const shown = await preview();
    const before = await snapshot();
    vi.spyOn(app.get(ImportRepository), 'createEmployees').mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: Prisma.prismaVersion.client,
      }),
    );
    expectRefused(await commit(shown.batchId), 409, 'IMPORT_STALE');
    expect(await snapshot()).toEqual(before);
    expect(await batchStatus(shown.batchId)).toBe('failed');
  });
});

describe('old previews: 409 IMPORT_EXPIRED after 24 hours (database clock)', () => {
  it('a preview made 25 hours ago is refused and becomes failed', async () => {
    const shown = await preview();
    await ageBatch(shown.batchId, 25);
    const before = await snapshot();
    expectRefused(await commit(shown.batchId), 409, 'IMPORT_EXPIRED');
    expect(await snapshot()).toEqual(before);
    expect(await batchStatus(shown.batchId)).toBe('failed');
    const [log] = await prisma.auditLog.findMany({ where: { action: 'import.failed' } });
    expect(log?.details).toEqual({ fileName, reason: 'expired' });
  });

  it('a preview made 23 hours ago is still applied', async () => {
    const shown = await preview();
    await ageBatch(shown.batchId, 23);
    expect((await commit(shown.batchId)).status).toBe(201);
  });
});

describe("one clock: the app's clock is never used", () => {
  /** The app's Date moved by `offset` ms (database untouched); log in again under it. */
  async function shiftAppClock(offset: number): Promise<void> {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + offset));
    managerCookie = await cookieFor(manager);
  }

  /**
   * Back to the real clock. The S3 client learned the fake clock's offset from the storage
   * server's replies; a few calls for a missing file let it learn the real one again (test only:
   * a real app's clock never jumps by days).
   */
  afterEach(async () => {
    vi.useRealTimers();
    const storage = app.get(StorageAdapter);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await storage.download('imports/clock-check.xlsx');
      } catch (error) {
        if (error instanceof StorageNotFoundError) return;
      }
    }
    throw new Error('Storage did not get back in sync with the real clock');
  });

  async function databaseNow(): Promise<number> {
    const [row] = await prisma.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
    return row?.now.getTime() ?? 0;
  }

  it.each([
    ['3 days ahead', 3 * DAY],
    ['3 days behind', -3 * DAY],
  ])(
    'app clock %s: a fresh preview applies, a later edit is still stale',
    async (_label, offset) => {
      await shiftAppClock(offset);

      const fresh = await preview();
      const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: fresh.batchId } });
      expect(Math.abs(batch.createdAt.getTime() - (await databaseNow()))).toBeLessThan(60_000);
      expect((await commit(fresh.batchId)).status).toBe(201);
      const committed = await prisma.importBatch.findUniqueOrThrow({
        where: { id: fresh.batchId },
      });
      expect(
        Math.abs((committed.committedAt?.getTime() ?? 0) - (await databaseNow())),
      ).toBeLessThan(60_000);

      const next = await preview();
      await prisma.employee.update({
        where: { employeeNumber: '1001' },
        data: { lastName: 'אחר' },
      });
      expectRefused(await commit(next.batchId), 409, 'IMPORT_STALE');
    },
  );

  it('timestamps written through Prisma come from the database, whatever the app sends', async () => {
    await shiftAppClock(-3 * DAY);
    const updated = await prisma.employee.update({
      where: { employeeNumber: '1001' },
      data: { lastName: 'אחר', createdAt: new Date(0), updatedAt: new Date(0) },
    });
    const stored = await prisma.employee.findUniqueOrThrow({ where: { id: updated.id } });
    expect(Math.abs(stored.updatedAt.getTime() - (await databaseNow()))).toBeLessThan(60_000);
    expect(stored.createdAt.getTime()).toBeGreaterThan(0);
  });
});

describe('an import never sends anything (FR-EMP-6)', () => {
  it('an email added for an employee with a no_email assignment: nothing queued or sent', async () => {
    await prisma.employee.update({
      where: { employeeNumber: '1001' },
      data: { email: null, emailStatus: 'missing' },
    });
    const target = await employee('1001');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: manager } });
    const template = await prisma.template.create({
      data: { name: 'נוהל', fileKey: 'templates/t.pdf', pageCount: 1, createdById: user.id },
    });
    const round = await prisma.round.create({
      data: {
        name: 'סבב',
        mode: 'single_template',
        status: 'active',
        linkExpiryDays: 60,
        createdById: user.id,
      },
    });
    const assignment = await prisma.assignment.create({
      data: {
        roundId: round.id,
        employeeId: target.id,
        departmentId: target.departmentId,
        templateId: template.id,
        status: 'no_email',
      },
    });
    const send = vi.spyOn(app.get(EmailAdapter), 'send');

    const shown = await preview();
    expect(shown.updatedEmployees.find((e) => e.employeeNumber === '1001')?.changes).toEqual([
      'email: (none) → e1001@example.com',
      'emailStatus: missing → valid',
    ]);
    expect((await commit(shown.batchId)).status).toBe(201);

    expect(await employee('1001')).toMatchObject({
      email: 'e1001@example.com',
      emailStatus: 'valid',
    });
    expect(await prisma.assignment.findUniqueOrThrow({ where: { id: assignment.id } })).toEqual(
      assignment,
    );
    expect(await prisma.emailMessage.count()).toBe(0);
    expect(await queuedJobs()).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('access and bad requests', () => {
  it('refuses a signed-out user with 401', async () => {
    const shown = await preview();
    expectRefused(await commit(shown.batchId, null), 401, 'UNAUTHORIZED');
    expect(await batchStatus(shown.batchId)).toBe('preview');
  });

  it('refuses an officer with 403', async () => {
    const shown = await preview();
    expectRefused(await commit(shown.batchId, officerCookie), 403, 'FORBIDDEN');
    expect(await batchStatus(shown.batchId)).toBe('preview');
    expect(await prisma.employee.count({ where: { employeeNumber: '2001' } })).toBe(0);
  });

  it('an unknown batch → 404', async () => {
    expectRefused(await commit('00000000-0000-4000-8000-000000000000'), 404, 'NOT_FOUND');
  });

  it('a batch id that is not a uuid → 400', async () => {
    expectRefused(await commit('not-a-uuid'), 400, 'VALIDATION_FAILED');
  });
});

/** A valid Israeli ID from an 8-digit base: the check digit makes the weighted sum end in 0. */
function idWithCheckDigit(base: number): string {
  const digits = String(base).padStart(8, '0');
  const sum = [...digits].reduce((total, digit, index) => {
    const product = Number(digit) * (index % 2 === 0 ? 1 : 2);
    return total + (product > 9 ? product - 9 : product);
  }, 0);
  return digits + String((10 - (sum % 10)) % 10);
}

describe('speed: 1,500 rows', () => {
  const COUNT = 1500;
  const rows = (lastName: string): FixtureRow[] =>
    Array.from({ length: COUNT }, (_, index) => ({
      employeeNumber: 50_000 + index,
      idNumber: idWithCheckDigit(40_000_000 + index),
      firstName: 'עובד',
      lastName: `${lastName} ${index}`,
      department: '15 - ממלאות מקום ירושלים',
      email: `w${index}@example.com`,
    }));

  async function timedCommit(batchId: string): Promise<{ ms: number; result: ImportCommitResult }> {
    const started = performance.now();
    const response = await commit(batchId);
    const ms = performance.now() - started;
    expect(response.status).toBe(201);
    return { ms, result: response.body as ImportCommitResult };
  }

  it('creates 1,500 employees, then updates all 1,500, each well within the limit', async () => {
    const ids = Array.from({ length: COUNT }, (_, index) => idWithCheckDigit(40_000_000 + index));
    expect(ids.every(isValidIdNumber)).toBe(true);

    const createPreview = await preview(await harGalXlsx(rows('בדיקה')));
    expect(createPreview.counts.rowsNew).toBe(COUNT);
    const created = await timedCommit(createPreview.batchId);
    expect(created.result.counts.rowsNew).toBe(COUNT);

    const updatePreview = await preview(await harGalXlsx(rows('שונה')));
    expect(updatePreview.counts.rowsUpdated).toBe(COUNT);
    const updated = await timedCommit(updatePreview.batchId);
    expect(updated.result.counts.rowsUpdated).toBe(COUNT);

    console.info(
      `1,500-row confirm: create ${Math.round(created.ms)} ms, update ${Math.round(updated.ms)} ms`,
    );
    // Prisma's default transaction limit is 5 s; the confirm allows 30 s.
    expect(created.ms).toBeLessThan(5000);
    expect(updated.ms).toBeLessThan(5000);
    expect(await prisma.employee.count({ where: { lastName: { startsWith: 'שונה' } } })).toBe(
      COUNT,
    );
    expect(await prisma.auditLog.count({ where: { action: 'employee.updated' } })).toBe(COUNT);
  }, 120_000);
});

describe('extra columns (3.19)', () => {
  const stored = {
    address: 'הרצל 1',
    city: 'ירושלים',
    birthDate: new Date('1975-01-02T00:00:00Z'),
    jobPercent: 50,
    hoursBaseCode: 3,
    studyFund: 'הראל',
  };
  const row1001: FixtureRow = {
    employeeNumber: 1001,
    idNumber: 12345674,
    firstName: 'משה',
    lastName: 'כהן',
    department: '15 - ממלאות מקום ירושלים',
    email: 'e1001@example.com',
  };
  const extraHeaders = [...FIXTURE_HEADERS, ...FIXTURE_EXTRA_HEADERS];

  beforeEach(async () => {
    await prisma.employee.update({ where: { employeeNumber: '1001' }, data: stored });
  });

  it('a file without any extra column changes no extra field', async () => {
    const before = await employee('1001');
    const shown = await preview();
    expect(shown.updatedEmployees.map((e) => e.employeeNumber)).not.toContain('1001');
    expect((await commit(shown.batchId)).status).toBe(201);
    expect(await employee('1001')).toEqual(before);
  });

  it('only filled cells overwrite; a date cell is the same day; bad cells are warnings', async () => {
    const bytes = await harGalXlsx(
      [
        {
          ...row1001,
          birthDate: new Date('1980-05-03T00:00:00Z'),
          city: null, // empty: keeps ירושלים
          jobPercent: 100,
          hoursBaseCode: 1,
          pensionFundA: ' מגדל ',
        },
        {
          employeeNumber: 2001,
          idNumber: 55500003,
          firstName: 'נועה',
          lastName: 'לוי',
          department: '15 - ממלאות מקום ירושלים',
          landlinePrefix: '02',
          landline: 6234567,
          mobilePrefix: 50,
          mobile: 1234567,
          birthDate: 'לא תאריך',
          jobPercent: 'מלא',
          address: 'יפו 5',
        },
      ],
      { headers: extraHeaders },
    );
    const shown = await preview(bytes);
    expect(shown.counts).toMatchObject({ rowsNew: 1, rowsUpdated: 1, rowsFailed: 0 });
    expect(shown.updatedEmployees[0]?.changes).toEqual([
      'birthDate: changed',
      'jobPercent: 50 → 100',
      'hoursBaseCode: 3 → 1',
      'pensionFundA: (none) → מגדל',
    ]);
    expect(shown.warnings.map(({ row, code, message }) => [row, code, message])).toEqual([
      [3, 'EXTRA_VALUE_INVALID', expect.stringContaining('תאריך לידה')],
      [3, 'EXTRA_VALUE_INVALID', expect.stringContaining('אחוז משרה')],
    ]);
    expect(JSON.stringify(shown)).not.toContain('1980');

    const response = await commit(shown.batchId);
    expect(response.status).toBe(201);
    expect(importCommitResultSchema.parse(response.body).counts).toEqual(shown.counts);
    const updated = await employee('1001');
    expect(updated).toMatchObject({
      address: 'הרצל 1',
      city: 'ירושלים',
      hoursBaseCode: 1,
      pensionFundA: 'מגדל',
      studyFund: 'הראל',
    });
    expect(updated.birthDate?.toISOString()).toBe('1980-05-03T00:00:00.000Z');
    expect(updated.jobPercent?.toNumber()).toBe(100);
    expect(await employee('2001')).toMatchObject({
      landline: '02-6234567',
      mobile: '050-1234567',
      address: 'יפו 5',
      birthDate: null,
      jobPercent: null,
    });
    const logs = await prisma.auditLog.findMany({ where: { action: 'employee.updated' } });
    expect(JSON.stringify(logs.map((log) => log.details))).not.toContain('1980');
  });
});
