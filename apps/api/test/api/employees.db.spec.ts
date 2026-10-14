import type {
  ApiError,
  Department,
  EmployeeCard,
  EmployeeListItem,
  FieldError,
  Paged,
} from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runSeed } from '../../prisma/run-seed.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { resetDatabase } from '../setup/database.js';

const seedPassword = 'test-seed-password';
const manager = 'manager@doc-signing.local';
const officer = 'officer@doc-signing.local';
const unknownId = '00000000-0000-4000-8000-000000000000';

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

/** Logs in and returns `sid=<token>` for a Cookie header. */
async function cookieFor(email: string): Promise<string> {
  const response = await request(httpServer(app))
    .post('/api/auth/login')
    .send({ email, password: seedPassword });
  expect(response.status).toBe(200);
  const lines = response.headers['set-cookie'] as unknown as string[];
  const line = lines.find((value) => value.startsWith('sid=')) ?? '';
  return line.split(';')[0] ?? '';
}

const errorOf = (response: request.Response) => (response.body as ApiError).error;
const cardOf = (response: request.Response) => response.body as EmployeeCard;
const pageOf = (response: request.Response) => response.body as Paged<EmployeeListItem>;
const numbersOf = (response: request.Response) =>
  pageOf(response).items.map(({ employeeNumber }) => employeeNumber);

function withCookie(req: request.Test, cookie?: string): request.Test {
  return cookie ? req.set('Cookie', cookie) : req;
}

function list(query: Record<string, string>, cookie = managerCookie) {
  return withCookie(request(httpServer(app)).get('/api/employees').query(query), cookie);
}

function create(body: object, cookie: string | undefined = managerCookie) {
  return withCookie(request(httpServer(app)).post('/api/employees'), cookie).send(body);
}

function update(id: string, body: object, cookie: string | undefined = managerCookie) {
  return withCookie(request(httpServer(app)).patch(`/api/employees/${id}`), cookie).send(body);
}

async function departmentId(code: number): Promise<string> {
  return (await prisma.department.findUniqueOrThrow({ where: { code } })).id;
}

async function employeeId(employeeNumber: string): Promise<string> {
  return (await prisma.employee.findUniqueOrThrow({ where: { employeeNumber } })).id;
}

function employeeAuditRows() {
  return prisma.auditLog.findMany({
    where: { action: { startsWith: 'employee.' } },
    orderBy: { id: 'asc' },
  });
}

async function newEmployee() {
  return {
    employeeNumber: '0002001',
    idNumber: '55500003', // 055500003 without its leading 0
    firstName: ' יונתן ',
    lastName: 'אלמוג',
    departmentId: await departmentId(19),
    email: ' Yonatan@Example.COM ',
    phone: '52 123 4567',
  };
}

describe('access', () => {
  const read = [
    ['GET', '/api/departments'],
    ['GET', '/api/employees'],
    ['GET', `/api/employees/${unknownId}`],
  ] as const;
  const write = [
    ['POST', '/api/employees'],
    ['PATCH', `/api/employees/${unknownId}`],
  ] as const;

  it.each([...read, ...write])('%s %s without a session → 401', async (method, path) => {
    const response = await request(httpServer(app))[
      method === 'GET' ? 'get' : method === 'POST' ? 'post' : 'patch'
    ](path);
    expect(response.status).toBe(401);
    expect(errorOf(response).code).toBe('UNAUTHORIZED');
  });

  it('an officer can read', async () => {
    expect((await list({}, officerCookie)).status).toBe(200);
    const departments = await withCookie(
      request(httpServer(app)).get('/api/departments'),
      officerCookie,
    );
    expect(departments.status).toBe(200);
    const card = await withCookie(
      request(httpServer(app)).get(`/api/employees/${await employeeId('1001')}`),
      officerCookie,
    );
    expect(card.status).toBe(200);
  });

  it('an officer gets 403 on create and edit, and nothing changes', async () => {
    const created = await create(await newEmployee(), officerCookie);
    expect(created.status).toBe(403);
    expect(errorOf(created).code).toBe('FORBIDDEN');

    const edited = await update(await employeeId('1001'), { firstName: 'אחר' }, officerCookie);
    expect(edited.status).toBe(403);
    expect(await prisma.employee.count()).toBe(20);
    expect(
      (await prisma.employee.findUniqueOrThrow({ where: { employeeNumber: '1001' } })).firstName,
    ).toBe('משה');
    expect(await employeeAuditRows()).toEqual([]);
  });

  it('there is no delete route', async () => {
    const response = await withCookie(
      request(httpServer(app)).delete(`/api/employees/${await employeeId('1001')}`),
      managerCookie,
    );
    expect(response.status).toBe(404);
  });
});

describe('GET /api/departments', () => {
  it('returns every department sorted by code', async () => {
    const response = await withCookie(
      request(httpServer(app)).get('/api/departments'),
      managerCookie,
    );
    expect(response.status).toBe(200);
    const { items } = response.body as { items: Department[] };
    expect(items.map(({ code, name }) => [code, name])).toEqual([
      [15, 'ממלאות מקום ירושלים'],
      [19, 'ממ חינוך מיוחד'],
      [61, 'ממלאות מקום אלעד-61'],
    ]);
    expect(Object.keys(items[0] ?? {}).sort()).toEqual(['code', 'id', 'isActive', 'name']);
  });
});

describe('GET /api/employees', () => {
  it('pages through everyone, sorted by last name, without ID numbers', async () => {
    const first = await list({ pageSize: '5' });
    expect(first.status).toBe(200);
    expect(pageOf(first)).toMatchObject({ total: 20, page: 1, pageSize: 5 });
    expect(pageOf(first).items).toHaveLength(5);
    const second = await list({ pageSize: '5', page: '4' });
    expect(pageOf(second).items).toHaveLength(5);
    expect(first.text).not.toMatch(/idNumber|012345674/);

    const all = pageOf(await list({ pageSize: '100' })).items.map(({ lastName }) => lastName);
    expect(all).toEqual([...all].sort((a, b) => a.localeCompare(b, 'he')));
    expect(pageOf(await list({ pageSize: '100' })).items[0]?.department).toEqual(
      expect.objectContaining({
        code: expect.any(Number) as number,
        name: expect.any(String) as string,
      }),
    );
  });

  it.each([
    ['first name', 'משה', ['1001']],
    ['last name (part)', 'כהן', ['1001', '1002']],
    ['full name', 'משה כהן', ['1001']],
    ['full name, last name first', 'כהן משה', ['1001']],
    ['full name with extra spaces', '  משה    כהן ', ['1001']],
    ['a name with a hyphen', 'הלוי-כץ', ['1009']],
    ['employee number', '1017', ['1017']],
    ['employee number with leading zeros', '01017', ['1017']],
    ['ID number', '012345674', ['1001']],
    ['ID number without its leading 0', '12345674', ['1001']],
  ])('finds by %s', async (_label, q, expected) => {
    const response = await list({ q });
    expect(response.status).toBe(200);
    expect(numbersOf(response).sort()).toEqual(expected);
  });

  it('never matches part of an ID number', async () => {
    expect(numbersOf(await list({ q: '1234567' }))).toEqual([]);
  });

  it('treats % and _ as plain characters', async () => {
    for (const q of ['%', '_', 'כ%ן', 'מש_']) {
      const response = await list({ q });
      expect(response.status).toBe(200);
      expect(pageOf(response).total).toBe(0);
    }
  });

  it('filters by department, email status, and both together', async () => {
    const dept15 = await departmentId(15);
    const inDept = pageOf(await list({ dept: dept15, pageSize: '100' }));
    expect(inDept.total).toBe(7);
    expect(inDept.items.every(({ department }) => department.code === 15)).toBe(true);

    expect(numbersOf(await list({ emailStatus: 'missing' })).sort()).toEqual(['1007', '1015']);
    expect(numbersOf(await list({ dept: dept15, emailStatus: 'missing' }))).toEqual(['1007']);
    expect(numbersOf(await list({ dept: dept15, q: 'כהן', emailStatus: 'valid' })).sort()).toEqual([
      '1001',
      '1002',
    ]);
    expect(pageOf(await list({ dept: await departmentId(19), q: 'כהן' })).total).toBe(0);
  });

  it('refuses bad filters with 400', async () => {
    const badQueries: Record<string, string>[] = [
      { dept: '15' },
      { emailStatus: 'nope' },
      { page: '0' },
    ];
    for (const query of badQueries) {
      const response = await list(query);
      expect(response.status).toBe(400);
      expect(errorOf(response).code).toBe('VALIDATION_FAILED');
    }
  });
});

describe('GET /api/employees/:id', () => {
  it('returns the card with the full ID number', async () => {
    const response = await withCookie(
      request(httpServer(app)).get(`/api/employees/${await employeeId('1001')}`),
      managerCookie,
    );
    expect(response.status).toBe(200);
    expect(cardOf(response)).toMatchObject({
      employeeNumber: '1001',
      idNumber: '012345674',
      firstName: 'משה',
      lastName: 'כהן',
      department: { code: 15, name: 'ממלאות מקום ירושלים' },
      emailStatus: 'valid',
      isActive: true,
    });
  });

  it('404 for an unknown employee', async () => {
    const response = await withCookie(
      request(httpServer(app)).get(`/api/employees/${unknownId}`),
      managerCookie,
    );
    expect(response.status).toBe(404);
    expect(errorOf(response).code).toBe('NOT_FOUND');
  });
});

describe('POST /api/employees', () => {
  it('adds an employee with normalized fields and logs it without the ID number', async () => {
    const response = await create(await newEmployee());
    expect(response.status).toBe(201);
    expect(cardOf(response)).toMatchObject({
      employeeNumber: '2001',
      idNumber: '055500003',
      firstName: 'יונתן',
      lastName: 'אלמוג',
      department: { code: 19 },
      email: 'yonatan@example.com',
      emailStatus: 'valid',
      phone: '052-1234567',
      isActive: true,
    });

    const [row, ...rest] = await employeeAuditRows();
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      action: 'employee.created',
      entityType: 'employee',
      entityId: cardOf(response).id,
      details: {
        employeeNumber: '2001',
        fullName: 'יונתן אלמוג',
        departmentCode: 19,
        emailStatus: 'valid',
      },
    });
    expect(JSON.stringify(row?.details)).not.toMatch(/55500003/);
  });

  it('no email → missing; a wrong format → invalid', async () => {
    // `undefined` is left out of the JSON body, so this sends no email field at all.
    const withoutEmail = { ...(await newEmployee()), email: undefined };
    expect(cardOf(await create(withoutEmail))).toMatchObject({
      email: null,
      emailStatus: 'missing',
    });
    const other = { ...withoutEmail, employeeNumber: '2002', idNumber: '055500011', email: 'nope' };
    expect(cardOf(await create(other))).toMatchObject({ email: 'nope', emailStatus: 'invalid' });
  });

  it('a duplicate employee number → 409 EMPLOYEE_NUMBER_TAKEN (leading zeros ignored)', async () => {
    const response = await create({ ...(await newEmployee()), employeeNumber: '01001' });
    expect(response.status).toBe(409);
    expect(errorOf(response).code).toBe('EMPLOYEE_NUMBER_TAKEN');
    expect(await prisma.employee.count()).toBe(20);
  });

  it('a duplicate ID number → 409 ID_NUMBER_TAKEN, also typed without its leading 0', async () => {
    const response = await create({ ...(await newEmployee()), idNumber: '12345674' });
    expect(response.status).toBe(409);
    expect(errorOf(response).code).toBe('ID_NUMBER_TAKEN');
    expect(response.text).not.toContain('12345674');
  });

  it('refuses a bad check digit, a bad phone or employee number, and an unknown department', async () => {
    const base = await newEmployee();
    const cases = [
      [{ idNumber: '055500004' }, 'idNumber', 'INVALID_ID_NUMBER'],
      [{ phone: '12' }, 'phone', 'INVALID_PHONE'],
      [{ employeeNumber: '12-3' }, 'employeeNumber', 'INVALID_EMPLOYEE_NUMBER'],
    ] as const;
    for (const [change, field, code] of cases) {
      const response = await create({ ...base, ...change });
      expect(response.status).toBe(400);
      expect(errorOf(response).details?.fields).toEqual([
        expect.objectContaining({ field, code }) as FieldError,
      ]);
    }

    const unknownDept = await create({ ...base, departmentId: unknownId });
    expect(unknownDept.status).toBe(400);
    expect(errorOf(unknownDept).code).toBe('DEPARTMENT_NOT_FOUND');
    expect(await prisma.employee.count()).toBe(20);
  });
});

describe('PATCH /api/employees/:id', () => {
  it('edits fields and logs each change as "field: old → new", never the ID value', async () => {
    const id = await employeeId('1001');
    const response = await update(id, {
      idNumber: '55500003',
      firstName: 'משה חיים',
      departmentId: await departmentId(61),
      phone: '02-1234567',
      isActive: false,
    });
    expect(response.status).toBe(200);
    expect(cardOf(response)).toMatchObject({
      idNumber: '055500003',
      firstName: 'משה חיים',
      department: { code: 61 },
      phone: '02-1234567',
      isActive: false,
    });

    const [row, ...rest] = await employeeAuditRows();
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ action: 'employee.updated', entityId: id });
    expect(row?.details).toEqual({
      changes: [
        'idNumber: changed',
        'firstName: משה → משה חיים',
        'departmentCode: 15 → 61',
        'phone: (none) → 02-1234567',
        'isActive: true → false',
      ],
    });
    expect(JSON.stringify(row?.details)).not.toMatch(/012345674|55500003/);
  });

  it('saving the same values changes nothing and logs nothing', async () => {
    const response = await update(await employeeId('1001'), {
      firstName: 'משה',
      email: 'E1001@example.com ',
    });
    expect(response.status).toBe(200);
    expect(await employeeAuditRows()).toEqual([]);
  });

  describe('email status (FR-EMP-4)', () => {
    async function bounced(): Promise<string> {
      const id = await employeeId('1002');
      await prisma.employee.update({ where: { id }, data: { emailStatus: 'bounced' } });
      return id;
    }

    it('same email (other case and spaces) → bounced stays bounced', async () => {
      const response = await update(await bounced(), { email: ' E1002@Example.com ' });
      expect(cardOf(response).emailStatus).toBe('bounced');
    });

    it('a different email → valid; a wrong format → invalid; empty → missing', async () => {
      const id = await bounced();
      expect(cardOf(await update(id, { email: 'new@example.com' })).emailStatus).toBe('valid');
      expect(cardOf(await update(id, { email: 'not-an-email' })).emailStatus).toBe('invalid');
      expect(cardOf(await update(id, { email: '' }))).toMatchObject({
        email: null,
        emailStatus: 'missing',
      });
    });

    it('editing other fields keeps the status', async () => {
      const response = await update(await bounced(), { lastName: 'לוי' });
      expect(cardOf(response).emailStatus).toBe('bounced');
    });

    it('adding an email sends nothing and queues nothing (FR-EMP-6)', async () => {
      const jobs = () =>
        prisma.$queryRaw<{ n: bigint }[]>`
          SELECT count(*) AS n FROM pgboss.job WHERE name <> 'maintenance-cleanup'`;
      const [before] = await jobs();
      const response = await update(await employeeId('1007'), { email: 'added@example.com' });
      expect(cardOf(response).emailStatus).toBe('valid');
      const [after] = await jobs();
      expect(after?.n).toBe(before?.n);
      expect(await prisma.emailMessage.count()).toBe(0);
    });
  });

  it('a department change does not move existing assignments', async () => {
    const id = await employeeId('1001');
    const dept15 = await departmentId(15);
    const createdById = (await prisma.user.findUniqueOrThrow({ where: { email: manager } })).id;
    const template = await prisma.template.create({
      data: { name: 'נוהל', fileKey: 'templates/t.pdf', pageCount: 1, createdById },
    });
    const round = await prisma.round.create({
      data: { name: 'סבב', mode: 'single_template', createdById },
    });
    const assignment = await prisma.assignment.create({
      data: { roundId: round.id, employeeId: id, departmentId: dept15, templateId: template.id },
    });

    expect((await update(id, { departmentId: await departmentId(19) })).status).toBe(200);
    const after = await prisma.assignment.findUniqueOrThrow({ where: { id: assignment.id } });
    expect(after.departmentId).toBe(dept15);
  });

  it('the employee number cannot be changed', async () => {
    const response = await update(await employeeId('1001'), { employeeNumber: '9999' });
    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_FAILED');
  });

  it("another employee's ID number → 409 ID_NUMBER_TAKEN", async () => {
    const response = await update(await employeeId('1001'), { idNumber: '023456783' });
    expect(response.status).toBe(409);
    expect(errorOf(response).code).toBe('ID_NUMBER_TAKEN');
  });

  it('unknown employee → 404; unknown department → 400; empty body → 400', async () => {
    expect((await update(unknownId, { firstName: 'א' })).status).toBe(404);
    const dept = await update(await employeeId('1001'), { departmentId: unknownId });
    expect(dept.status).toBe(400);
    expect(errorOf(dept).code).toBe('DEPARTMENT_NOT_FOUND');
    expect((await update(await employeeId('1001'), {})).status).toBe(400);
  });
});
