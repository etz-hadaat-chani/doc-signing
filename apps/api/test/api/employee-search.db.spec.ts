import {
  type ApiError,
  type EmployeeListItem,
  employeeListItemSchema,
  pagedSchema,
} from '@doc-signing/shared';
import { type INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSeed } from '../../prisma/run-seed.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { resetDatabase } from '../setup/database.js';

/**
 * `POST /api/employees/search` (5.2): the employee list's search, with the text in the body. The
 * text may be an ID number, so it never goes in a URL: `GET /api/employees?q=` is refused.
 */

const seedPassword = 'test-seed-password';
const pagedEmployees = pagedSchema(employeeListItemSchema);

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
  managerCookie = await cookieFor('manager@doc-signing.local');
  officerCookie = await cookieFor('officer@doc-signing.local');
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
  const line = lines.find((value) => value.startsWith('sid=')) ?? '';
  return line.split(';')[0] ?? '';
}

function search(body: object, cookie: string | null = managerCookie) {
  const req = request(httpServer(app)).post('/api/employees/search').send(body);
  return cookie ? req.set('Cookie', cookie) : req;
}

async function found(body: object): Promise<EmployeeListItem[]> {
  const response = await search(body);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return pagedEmployees.parse(response.body).items;
}

async function numbersFound(body: object): Promise<string[]> {
  return (await found(body)).map(({ employeeNumber }) => employeeNumber).sort();
}

async function departmentId(code: number): Promise<string> {
  return (await prisma.department.findUniqueOrThrow({ where: { code } })).id;
}

const errorOf = (response: request.Response) => (response.body as ApiError).error;

describe('access', () => {
  it('needs a session; managers and officers get the same answer', async () => {
    expect((await search({ q: 'כהן' }, null)).status).toBe(401);
    const manager = await search({ q: 'כהן' });
    const officer = await search({ q: 'כהן' }, officerCookie);
    expect(manager.status).toBe(200);
    expect(officer.status).toBe(200);
    expect(officer.body).toEqual(manager.body);
  });
});

describe('POST /api/employees/search', () => {
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
    expect(await numbersFound({ q })).toEqual(expected);
  });

  it('never matches part of an ID number', async () => {
    expect(await numbersFound({ q: '1234567' })).toEqual([]);
  });

  it('treats % and _ as plain characters', async () => {
    for (const q of ['%', '_', 'כ%ן', 'מש_']) expect(await numbersFound({ q })).toEqual([]);
  });

  it('without search text it is the plain list', async () => {
    const response = await search({ q: '   ', pageSize: 5 });
    expect(pagedEmployees.parse(response.body)).toMatchObject({ total: 20, page: 1, pageSize: 5 });
  });

  it('combines the search with the filters and pages', async () => {
    const dept15 = await departmentId(15);
    expect(await numbersFound({ q: 'כהן', dept: dept15, emailStatus: 'valid' })).toEqual([
      '1001',
      '1002',
    ]);
    expect(await numbersFound({ q: 'כהן', dept: await departmentId(19) })).toEqual([]);

    await prisma.employee.update({ where: { employeeNumber: '1002' }, data: { isActive: false } });
    expect(await numbersFound({ q: 'כהן', active: true })).toEqual(['1001']);
    expect(await numbersFound({ q: 'כהן', active: false })).toEqual(['1002']);

    const firstPage = pagedEmployees.parse((await search({ q: 'כהן', pageSize: 1 })).body);
    const secondPage = pagedEmployees.parse(
      (await search({ q: 'כהן', pageSize: 1, page: 2 })).body,
    );
    expect(firstPage.total).toBe(2);
    expect(secondPage.page).toBe(2);
    expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);
  });

  it('returns list rows only: no ID number or extra details', async () => {
    const response = await search({ q: '012345674' });
    expect(response.text).not.toMatch(/idNumber|012345674|mobile|birthDate/);
  });

  it('refuses a bad body with 400', async () => {
    const bad = [{ q: 'x'.repeat(101) }, { q: 'x', extra: true }, { dept: '15' }, { page: 0 }];
    for (const body of bad) {
      const response = await search(body);
      expect(response.status).toBe(400);
      expect(errorOf(response).code).toBe('VALIDATION_FAILED');
    }
  });
});

describe('search text is never in a URL', () => {
  it('GET /api/employees?q= → 400', async () => {
    const response = await request(httpServer(app))
      .get('/api/employees')
      .query({ q: 'כהן' })
      .set('Cookie', managerCookie);
    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_FAILED');
  });

  it('writes no search text and no ID number to any log or audit row', async () => {
    const messages: string[] = [];
    for (const level of ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((message: unknown) => {
        messages.push(String(message));
      });
    }
    expect(await numbersFound({ q: '012345674' })).toEqual(['1001']);
    expect(await numbersFound({ q: 'משה כהן' })).toEqual(['1001']);
    await search({ q: '012345674', extra: true });
    await request(httpServer(app))
      .get('/api/employees')
      .query({ q: '012345674' })
      .set('Cookie', managerCookie);

    const everything = [
      ...messages,
      JSON.stringify(await prisma.auditLog.findMany({ select: { details: true } })),
    ].join('\n');
    for (const text of ['012345674', '12345674', 'משה כהן']) {
      expect(everything).not.toContain(text);
    }
  });
});
