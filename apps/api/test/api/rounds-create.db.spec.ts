import {
  type ApiError,
  ERROR_MESSAGES,
  OPEN_ASSIGNMENT_STATUSES,
  type RecipientsPreviewReport,
  recipientsPreviewReportSchema,
  type RoundCreated,
  roundCreatedSchema,
  templateItemSchema,
} from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runSeed } from '../../prisma/run-seed.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import type { AssignmentStatus, Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import { ROUND_CREATE_LOCK } from '../../src/modules/rounds/rounds.repository.js';
import { type FieldSpec, layout } from '../fixtures/contracts.js';
import { testPdf } from '../fixtures/pdf.js';
import { READY_FIELDS } from '../fixtures/rounds.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { createTestPrisma, resetDatabase } from '../setup/database.js';

const seedPassword = 'test-seed-password';

let app: INestApplication;
let prisma: PrismaService;
/** A second client with its own connections: holds locks while the API waits for them. */
let holder: PrismaClient;
let managerCookie: string;
let officerCookie: string;
let managerId: string;
/** Department id by code (seed: 15 has 7 employees, 19 has 6, 61 has 7). */
let dept: Record<15 | 19 | 61, string>;
/** Seed employee ids by employee number ("1001"…). */
let emp: Record<string, string>;

/** Name, ID, the email pair and a signature: nothing a seed employee lacks. */
const BASIC: FieldSpec[] = READY_FIELDS.filter(({ fieldType }) =>
  ['full_name', 'id_number', 'email_input', 'no_email_checkbox', 'signature'].includes(fieldType),
);
const NOT_READY: FieldSpec[] = BASIC.filter(({ fieldType }) => fieldType !== 'signature');

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  holder = createTestPrisma();
});

beforeEach(async () => {
  await resetDatabase(prisma);
  await runSeed(prisma, { password: seedPassword });
  managerCookie = await cookieFor('manager@doc-signing.local');
  officerCookie = await cookieFor('officer@doc-signing.local');
  managerId = (
    await prisma.user.findUniqueOrThrow({ where: { email: 'manager@doc-signing.local' } })
  ).id;
  const departments = await prisma.department.findMany();
  const byCode = (code: number) => departments.find((d) => d.code === code)?.id ?? '';
  dept = { 15: byCode(15), 19: byCode(19), 61: byCode(61) };
  const employees = await prisma.employee.findMany({ select: { id: true, employeeNumber: true } });
  emp = Object.fromEntries(employees.map((e) => [e.employeeNumber, e.id]));
  await prisma.employee.updateMany({
    data: { email: 'someone@example.com', emailStatus: 'valid', address: 'הרב קוק 12' },
  });
});

afterAll(async () => {
  await holder.$disconnect();
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

/** A template linked to these departments with these positions (made-up one-page PDF). */
async function template(
  name: string,
  departmentIds: string[],
  fields: FieldSpec[] = BASIC,
): Promise<string> {
  const created = await server()
    .post('/api/templates')
    .set('Cookie', managerCookie)
    .field('name', name)
    .field('departmentIds', departmentIds.join(','))
    .attach('file', await testPdf(), 'חוזה.pdf');
  expect(created.status).toBe(201);
  const id = templateItemSchema.parse(created.body).id;
  const patched = await server()
    .patch(`/api/templates/${id}`)
    .set('Cookie', managerCookie)
    .send({ fields: layout(fields) });
  expect(patched.status).toBe(200);
  return id;
}

function post(path: string, body: object, cookie: string | null = managerCookie) {
  const req = server().post(path).send(body);
  if (cookie) req.set('Cookie', cookie);
  return req;
}

async function preview(body: object): Promise<RecipientsPreviewReport> {
  const response = await post('/api/rounds/recipients-preview', body);
  expect(response.status).toBe(200);
  return recipientsPreviewReportSchema.parse(response.body);
}

async function create(body: object): Promise<RoundCreated> {
  const response = await post('/api/rounds', body);
  expect(response.status).toBe(201);
  return roundCreatedSchema.parse(response.body);
}

const single = (templateId: string, recipients: object, extra: object = {}) => ({
  mode: 'single_template',
  templateId,
  recipients,
  ...extra,
});
const named = (selection: object, name = 'סבב ניסיון') => ({ ...selection, name });

/** An earlier round with one assignment per given employee, all in the same status. */
async function earlierRound(
  templateId: string,
  employeeNumbers: string[],
  status: AssignmentStatus,
): Promise<void> {
  const round = await prisma.round.create({
    data: {
      name: 'סבב קודם',
      mode: 'single_template',
      status: status === 'signed' ? 'closed' : 'active',
      linkExpiryDays: 60,
      linkExpiresAt: new Date(Date.now() + 86_400_000),
      createdById: managerId,
    },
  });
  for (const number of employeeNumbers) {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNumber: number } });
    await prisma.assignment.create({
      data: {
        roundId: round.id,
        employeeId: employee.id,
        departmentId: employee.departmentId,
        templateId,
        status,
        ...(status === 'signed' && {
          signedAt: new Date('2026-03-01T08:00:00Z'),
          signMethod: 'digital',
          signedFileKey: `rounds/${round.id}/${number}.pdf`,
        }),
      },
    });
  }
}

/** Everything round creation writes, to check that a refusal wrote nothing. */
async function written() {
  return {
    rounds: await prisma.round.count({ where: { name: { not: 'סבב קודם' } } }),
    roundTemplates: await prisma.roundTemplate.count(),
    audit: await prisma.auditLog.count({ where: { action: 'round.created' } }),
    lockedTemplates: await prisma.template.count({ where: { isLocked: true } }),
  };
}
const NOTHING = { rounds: 0, roundTemplates: 0, audit: 0, lockedTemplates: 0 };

/** The assignments of a round: employee number → status / department / template. */
async function assignmentsOf(roundId: string) {
  const rows = await prisma.assignment.findMany({
    where: { roundId },
    select: {
      status: true,
      departmentId: true,
      templateId: true,
      employee: { select: { employeeNumber: true } },
    },
  });
  return new Map(rows.map((row) => [row.employee.employeeNumber, row]));
}

describe('POST /api/rounds: access and input', () => {
  it('creates for a manager (201), refuses an officer (403) and a signed-out caller (401)', async () => {
    const id = await template('חוזה', [dept[15]]);
    const body = named(single(id, { employeeIds: [emp['1001']] }));
    expect((await post('/api/rounds', body, officerCookie)).status).toBe(403);
    expect((await post('/api/rounds', body, null)).status).toBe(401);
    expect((await post('/api/rounds', body)).status).toBe(201);
  });

  it.each([
    ['no name', {}, 'name'],
    ['an empty name', { name: '   ' }, 'name'],
    ['a name of 151 characters', { name: 'א'.repeat(151) }, 'name'],
    [
      'interval 0',
      { name: 'סבב', settings: { reminderIntervalDays: 0 } },
      'settings.reminderIntervalDays',
    ],
    ['expiry 366', { name: 'סבב', settings: { linkExpiryDays: 366 } }, 'settings.linkExpiryDays'],
    ['an unknown field', { name: 'סבב', color: 'red' }, ''],
  ])('refuses %s with a Hebrew message (400)', async (_case, extra, field) => {
    const id = await template('חוזה', [dept[15]]);
    const response = await post('/api/rounds', { ...single(id, { all: true }), ...extra });
    expect(response.status).toBe(400);
    const error = errorOf(response);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toBe(ERROR_MESSAGES.VALIDATION_FAILED);
    expect(error.details?.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ field })]),
    );
    expect(await written()).toEqual(NOTHING);
  });
});

describe('creating a round', () => {
  it('single_template: a draft, one round template for everyone, one assignment each', async () => {
    const id = await template('חוזה', [dept[15]]);
    const created = await create(named(single(id, { departmentIds: [dept[15], dept[19]] })));
    expect(created).toMatchObject({
      name: 'סבב ניסיון',
      mode: 'single_template',
      status: 'draft',
      linkExpiresAt: null,
      templates: [{ departmentId: null, department: null, template: { id, version: 1 } }],
      counts: { recipients: 13, inRound: 13, willSendEmail: 13 },
    });
    const round = await prisma.round.findUniqueOrThrow({ where: { id: created.id } });
    expect(round).toMatchObject({ status: 'draft', linkExpiresAt: null, createdById: managerId });
    expect(await prisma.roundTemplate.findMany({ where: { roundId: created.id } })).toEqual([
      expect.objectContaining({ departmentId: null, templateId: id }),
    ]);
    const rows = await assignmentsOf(created.id);
    expect(rows.size).toBe(13);
    expect(new Set([...rows.values()].map(({ status }) => status))).toEqual(new Set(['pending']));
    expect(new Set([...rows.values()].map(({ templateId }) => templateId))).toEqual(new Set([id]));
  });

  it('by_department: each department its template, the chosen one where it has several', async () => {
    const a = await template('חוזה א', [dept[15]]);
    const b = await template('חוזה ב', [dept[15]]);
    const c = await template('חוזה 19', [dept[19]]);
    const created = await create(
      named({
        mode: 'by_department',
        departmentTemplates: [{ departmentId: dept[15], templateId: b }],
        recipients: { all: true },
      }),
    );
    expect(created.templates.map(({ departmentId, template: t }) => [departmentId, t.id])).toEqual([
      [dept[15], b],
      [dept[19], c],
    ]);
    // Department 61 has no template: its 7 employees are left out.
    expect(created.counts).toMatchObject({ recipients: 20, inRound: 13, noTemplate: 7 });
    const rows = [...(await assignmentsOf(created.id)).values()];
    expect(
      rows.filter((row) => row.departmentId === dept[15]).map((row) => row.templateId),
    ).toEqual(Array.from({ length: 7 }, () => b));
    expect(
      rows.filter((row) => row.departmentId === dept[19]).map((row) => row.templateId),
    ).toEqual(Array.from({ length: 6 }, () => c));
    expect(rows.some(({ templateId }) => templateId === a)).toBe(false);
  });

  it('gives missing_data to an employee missing a value, also when she has no email', async () => {
    const id = await template('חוזה', [dept[15]], READY_FIELDS);
    await prisma.employee.update({ where: { id: emp['1001'] }, data: { address: null } });
    await prisma.employee.update({
      where: { id: emp['1002'] },
      data: { address: null, email: null, emailStatus: 'missing' },
    });
    await prisma.employee.update({
      where: { id: emp['1003'] },
      data: { email: null, emailStatus: 'missing' },
    });
    const created = await create(
      named(single(id, { employeeIds: [emp['1001'], emp['1002'], emp['1003'], emp['1004']] })),
    );
    expect(created.counts).toMatchObject({
      inRound: 4,
      missingData: 2,
      noEmail: 1,
      willSendEmail: 1,
    });
    const rows = await assignmentsOf(created.id);
    expect(Object.fromEntries([...rows].map(([number, row]) => [number, row.status]))).toEqual({
      '1001': 'missing_data',
      '1002': 'missing_data',
      '1003': 'no_email',
      '1004': 'pending',
    });
  });

  it('adds each employee once, whatever the choices overlap', async () => {
    const id = await template('חוזה', [dept[15]]);
    const created = await create(
      named(single(id, { all: true, departmentIds: [dept[15]], employeeIds: [emp['1001']] })),
    );
    expect(created.counts.inRound).toBe(20);
    expect(await prisma.assignment.count({ where: { roundId: created.id } })).toBe(20);
  });
});

describe('the same body as the preview', () => {
  it('gives the same people and counts', async () => {
    const a = await template('חוזה א', [dept[15], dept[19]], READY_FIELDS);
    const b = await template('חוזה ב', [dept[15]]);
    await prisma.employee.update({ where: { id: emp['1001'] }, data: { address: null } });
    await prisma.employee.update({
      where: { id: emp['1008'] },
      data: { email: null, emailStatus: 'bounced' },
    });
    await prisma.employee.update({ where: { id: emp['1009'] }, data: { isActive: false } });
    const selections = [
      single(a, { all: true }),
      single(b, { departmentIds: [dept[19]], employeeIds: [emp['1001']] }),
      {
        mode: 'by_department',
        departmentTemplates: [{ departmentId: dept[15], templateId: a }],
        recipients: { all: true },
        alreadySigned: 'send_again',
      },
    ];
    for (const selection of selections) {
      const expected = await preview(selection);
      const created = await create(named(selection));
      expect(created.counts).toEqual(expected.counts);
      expect(await prisma.assignment.count({ where: { roundId: created.id } })).toBe(
        expected.counts.inRound,
      );
      // Cancel it so the next body starts from the same place.
      await prisma.assignment.updateMany({
        where: { roundId: created.id },
        data: { status: 'cancelled' },
      });
    }
  });
});

describe('refusals', () => {
  it('409 while a department needs a template choice, with the blocker, and writes nothing', async () => {
    await template('חוזה א', [dept[15]]);
    await template('חוזה ב', [dept[15]]);
    const response = await post(
      '/api/rounds',
      named({ mode: 'by_department', recipients: { departmentIds: [dept[15]] } }),
    );
    expect(response.status).toBe(409);
    expect(errorOf(response)).toMatchObject({
      code: 'ROUND_CANNOT_BE_CREATED',
      message: ERROR_MESSAGES.ROUND_CANNOT_BE_CREATED,
      details: {
        blockers: [
          expect.objectContaining({
            code: 'DEPARTMENT_TEMPLATE_CHOICE_NEEDED',
            departmentId: dept[15],
          }),
        ],
      },
    });
    expect(await written()).toEqual(NOTHING);
  });

  it('409 for a template that is not ready, with its reasons', async () => {
    const id = await template('חוזה', [dept[15]], NOT_READY);
    const response = await post('/api/rounds', named(single(id, { all: true })));
    expect(response.status).toBe(409);
    expect(errorOf(response).details?.blockers).toEqual([
      expect.objectContaining({
        code: 'TEMPLATE_NOT_READY',
        templateId: id,
        reasons: [expect.objectContaining({ code: 'NO_MAIN_SIGNATURE' })],
      }),
    ]);
    expect(await written()).toEqual(NOTHING);
  });

  it('409 when nobody would be added', async () => {
    const id = await template('חוזה', [dept[15]]);
    await earlierRound(id, ['1001'], 'sent');
    const response = await post('/api/rounds', named(single(id, { employeeIds: [emp['1001']] })));
    expect(response.status).toBe(409);
    expect(errorOf(response).details?.blockers).toEqual([
      expect.objectContaining({ code: 'NO_RECIPIENTS_IN_ROUND' }),
    ]);
    expect(await written()).toEqual(NOTHING);
  });
});

describe('earlier rounds of the same document', () => {
  it('skips those who signed, or adds them again with send_again', async () => {
    const id = await template('חוזה', [dept[15]]);
    await earlierRound(id, ['1001'], 'signed');
    const choice = { employeeIds: [emp['1001'], emp['1002']] };
    const skipped = await create(named(single(id, choice)));
    expect([...(await assignmentsOf(skipped.id)).keys()]).toEqual(['1002']);
    expect(skipped.counts.alreadySigned).toBe(1);

    await prisma.assignment.updateMany({
      where: { roundId: skipped.id },
      data: { status: 'cancelled' },
    });
    const again = await create(named(single(id, choice, { alreadySigned: 'send_again' })));
    expect([...(await assignmentsOf(again.id)).keys()].sort()).toEqual(['1001', '1002']);
  });

  it('leaves out an employee who has the document open elsewhere, also as missing_data', async () => {
    const id = await template('חוזה', [dept[15]]);
    await earlierRound(id, ['1001'], 'sent');
    await earlierRound(id, ['1002'], 'missing_data');
    const created = await create(
      named(single(id, { employeeIds: [emp['1001'], emp['1002'], emp['1003']] })),
    );
    expect([...(await assignmentsOf(created.id)).keys()]).toEqual(['1003']);
    expect(created.counts.alreadyOpen).toBe(2);
  });
});

describe('after the round is created', () => {
  it('keeps the department of the moment of creation when the employee moves', async () => {
    const id = await template('חוזה', [dept[15], dept[19]]);
    const created = await create(named(single(id, { employeeIds: [emp['1001']] })));
    expect((await assignmentsOf(created.id)).get('1001')?.departmentId).toBe(dept[15]);
    await prisma.employee.update({ where: { id: emp['1001'] }, data: { departmentId: dept[19] } });
    expect((await assignmentsOf(created.id)).get('1001')?.departmentId).toBe(dept[15]);
  });

  it('copies the default settings, and uses the values the manager gives', async () => {
    const patched = await server()
      .patch('/api/settings')
      .set('Cookie', managerCookie)
      .send({ reminderIntervalDays: 4, maxReminders: 10, linkExpiryDays: 90 });
    expect(patched.status).toBe(200);
    const id = await template('חוזה', [dept[15]]);
    const defaults = await create(named(single(id, { employeeIds: [emp['1001']] })));
    expect(defaults.settings).toEqual({
      remindersEnabled: true,
      reminderIntervalDays: 4,
      maxReminders: 10,
      linkExpiryDays: 90,
    });
    const settings = { remindersEnabled: false, maxReminders: null, linkExpiryDays: 30 };
    const chosen = await create(named(single(id, { employeeIds: [emp['1002']] }, { settings })));
    expect(chosen.settings).toEqual({ ...settings, reminderIntervalDays: 4 });
    expect(await prisma.round.findUniqueOrThrow({ where: { id: chosen.id } })).toMatchObject({
      remindersEnabled: false,
      reminderIntervalDays: 4,
      maxReminders: null,
      linkExpiryDays: 30,
      linkExpiresAt: null,
    });
  });

  it('locks its templates: an edit makes a new version and the round keeps its own', async () => {
    const id = await template('חוזה', [dept[15]]);
    const created = await create(named(single(id, { employeeIds: [emp['1001']] })));
    expect(await prisma.template.findUniqueOrThrow({ where: { id } })).toMatchObject({
      isLocked: true,
    });
    const edited = await server()
      .patch(`/api/templates/${id}`)
      .set('Cookie', managerCookie)
      .send({ name: 'חוזה מתוקן' });
    expect(edited.status).toBe(200);
    const version2 = templateItemSchema.parse(edited.body);
    expect(version2.version).toBe(2);
    expect(version2.id).not.toBe(id);
    expect((await assignmentsOf(created.id)).get('1001')?.templateId).toBe(id);
  });

  it('writes one audit row with ids, settings and counts, never names', async () => {
    const id = await template('חוזה', [dept[15]]);
    const roundName = ['תיקון: סבב', 'שרה כהן'].join(' - ');
    const created = await create(named(single(id, { departmentIds: [dept[15]] }), roundName));
    const rows = await prisma.auditLog.findMany({ where: { action: 'round.created' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityType: 'round', entityId: created.id, userId: managerId });
    expect(rows[0]?.details).toEqual({
      mode: 'single_template',
      all: false,
      departmentCount: 1,
      employeeIdCount: 0,
      templateIds: [id],
      alreadySigned: 'skip',
      settings: created.settings,
      counts: created.counts,
    });
    expect(JSON.stringify(rows[0]?.details)).not.toMatch(/שרה|כהן|תיקון|1001/);
  });
});

/** Waits until at least `count` connections of the test database wait for a lock. */
async function lockWaiters(count: number): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const [row] = await holder.$queryRaw<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if ((row?.waiting ?? 0) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Fewer than ${String(count)} connections waited for the lock`);
}

/**
 * Opens a transaction on the second client, runs `start` in it and keeps it open: `finish` runs
 * its last steps and commits.
 */
async function hold(start: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  let finishWith: (last: (tx: Prisma.TransactionClient) => Promise<unknown>) => void = () => {};
  const lastSteps = new Promise<(tx: Prisma.TransactionClient) => Promise<unknown>>((resolve) => {
    finishWith = resolve;
  });
  let started: () => void = () => {};
  const isStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const done = holder.$transaction(
    async (tx) => {
      await start(tx);
      started();
      await (
        await lastSteps
      )(tx);
    },
    { timeout: 30_000 },
  );
  await isStarted;
  return {
    finish: async (last: (tx: Prisma.TransactionClient) => Promise<unknown> = async () => {}) => {
      finishWith(last);
      await done;
    },
  };
}

/** Open assignments per employee for this template (never more than one). */
async function openPerEmployee(templateId: string): Promise<number[]> {
  const rows = await prisma.assignment.groupBy({
    by: ['employeeId'],
    where: { templateId, status: { in: [...OPEN_ASSIGNMENT_STATUSES] } },
    _count: true,
  });
  return rows.map(({ _count }) => _count);
}

describe('two managers at once', () => {
  it('two creates with the same body: one round, every employee in it once', async () => {
    for (let round = 1; round <= 5; round += 1) {
      const id = await template(`חוזה ${String(round)}`, [dept[15]]);
      const body = named(single(id, { departmentIds: [dept[15]] }));
      const answers = await Promise.all([post('/api/rounds', body), post('/api/rounds', body)]);
      expect(answers.map(({ status }) => status).sort()).toEqual([201, 409]);
      const refused = answers.find(({ status }) => status === 409);
      expect(refused && errorOf(refused).details?.blockers).toEqual([
        expect.objectContaining({ code: 'NO_RECIPIENTS_IN_ROUND' }),
      ]);
      expect(await openPerEmployee(id)).toEqual(Array.from({ length: 7 }, () => 1));
    }
  });

  it('a create waiting for another one sees its assignments (held in order)', async () => {
    const id = await template('חוזה', [dept[15]]);
    const locked = await hold(
      (tx) =>
        tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${ROUND_CREATE_LOCK}::bigint)`,
    );
    const body = named(single(id, { departmentIds: [dept[15], dept[19]] }));
    const first = post('/api/rounds', body).then((r) => r);
    const second = post('/api/rounds', body).then((r) => r);
    await lockWaiters(2);
    await locked.finish();
    const answers = await Promise.all([first, second]);
    expect(answers.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(await openPerEmployee(id)).toEqual(Array.from({ length: 13 }, () => 1));
  });

  it('catches a template archived while the round was being created, and writes nothing', async () => {
    const id = await template('חוזה', [dept[15]]);
    // An edit in progress: it holds the template row, as TemplatesService does.
    const editor = await hold(
      (tx) => tx.$queryRaw`SELECT id FROM templates WHERE id = ${id}::uuid FOR UPDATE`,
    );
    const creating = post('/api/rounds', named(single(id, { all: true }))).then((r) => r);
    await lockWaiters(1);
    await editor.finish((tx) => tx.template.update({ where: { id }, data: { isArchived: true } }));
    const response = await creating;
    expect(response.status).toBe(409);
    expect(errorOf(response)).toMatchObject({
      code: 'ROUND_TEMPLATES_CHANGED',
      message: ERROR_MESSAGES.ROUND_TEMPLATES_CHANGED,
      details: { templateIds: [id] },
    });
    expect(await written()).toEqual(NOTHING);
    expect(await prisma.assignment.count()).toBe(0);
  });
});
