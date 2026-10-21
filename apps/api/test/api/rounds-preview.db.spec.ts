import {
  type ApiError,
  ERROR_MESSAGES,
  type RecipientsPreviewReport,
  recipientsPreviewReportSchema,
  templateItemSchema,
} from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runSeed } from '../../prisma/run-seed.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import type { AssignmentStatus, RoundStatus } from '../../src/generated/prisma/client.js';
import { type FieldSpec, layout } from '../fixtures/contracts.js';
import { testPdf } from '../fixtures/pdf.js';
import { testPng } from '../fixtures/png.js';
import { READY_FIELDS } from '../fixtures/rounds.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { resetDatabase } from '../setup/database.js';

const seedPassword = 'test-seed-password';

let app: INestApplication;
let prisma: PrismaService;
let managerCookie: string;
let officerCookie: string;
let managerId: string;
/** Department id by code (seed: 15, 19, 61). */
let dept: Record<15 | 19 | 61, string>;
/** Seed employee ids by employee number ("1001"…). */
let emp: Record<string, string>;

/** Name, ID, the email pair and a signature: nothing a seed employee lacks. */
const BASIC: FieldSpec[] = READY_FIELDS.filter(({ fieldType }) =>
  ['full_name', 'id_number', 'email_input', 'no_email_checkbox', 'signature'].includes(fieldType),
);
const NOT_READY: FieldSpec[] = BASIC.filter(({ fieldType }) => fieldType !== 'signature');
const PRE_SIGNED: FieldSpec[] = [...BASIC, { fieldType: 'employer_signature' }];

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
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
  // Everyone has a valid email unless a test says otherwise.
  await prisma.employee.updateMany({
    data: {
      email: 'someone@example.com',
      emailStatus: 'valid',
      address: 'הרב קוק 12',
      city: 'ירושלים',
    },
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
  return (lines.find((value) => value.startsWith('sid=')) ?? '').split(';')[0] ?? '';
}

const server = () => request(httpServer(app));
const errorOf = (response: request.Response) => (response.body as ApiError).error;

/** A template linked to these departments with these positions (made-up one-page PDF). */
async function template(
  name: string,
  departmentIds: string[],
  fields: FieldSpec[] = BASIC,
  employerSignatureMode: 'none' | 'pre_signed' = 'none',
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
    .send({ fields: layout(fields), employerSignatureMode });
  expect(patched.status).toBe(200);
  return id;
}

function preview(body: object, cookie: string | null = managerCookie) {
  const req = server().post('/api/rounds/recipients-preview').send(body);
  if (cookie) req.set('Cookie', cookie);
  return req;
}

async function report(body: object): Promise<RecipientsPreviewReport> {
  const response = await preview(body);
  expect(response.status).toBe(200);
  return recipientsPreviewReportSchema.parse(response.body);
}

const single = (templateId: string, recipients: object, extra: object = {}) => ({
  mode: 'single_template',
  templateId,
  recipients,
  ...extra,
});

/** A round with one assignment per given employee, all in the same status. */
async function earlierRound(
  templateId: string,
  employeeNumbers: string[],
  status: AssignmentStatus,
  round: { status?: RoundStatus; linkExpiresAt?: Date | null; name?: string } = {},
): Promise<string> {
  const created = await prisma.round.create({
    data: {
      name: round.name ?? 'סבב קודם',
      mode: 'single_template',
      status: round.status ?? 'active',
      linkExpiryDays: 60,
      linkExpiresAt:
        round.linkExpiresAt === undefined ? new Date(Date.now() + 86_400_000) : round.linkExpiresAt,
      createdById: managerId,
    },
  });
  for (const number of employeeNumbers) {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { employeeNumber: number } });
    const signed = status === 'signed' || status === 'signed_manual';
    await prisma.assignment.create({
      data: {
        roundId: created.id,
        employeeId: employee.id,
        departmentId: employee.departmentId,
        templateId,
        status,
        ...(signed && {
          signedAt: new Date('2026-03-01T08:00:00Z'),
          signMethod: status === 'signed' ? 'digital' : 'manual',
          signedFileKey: `rounds/${created.id}/${String(employee.employeeNumber)}.pdf`,
        }),
      },
    });
  }
  return created.id;
}

const numbersOf = (list: { items: { employeeNumber: string }[] }) =>
  list.items.map(({ employeeNumber }) => employeeNumber);

describe('POST /api/rounds/recipients-preview: access and input', () => {
  it('answers a manager, refuses an officer (403) and a signed-out caller (401)', async () => {
    const id = await template('חוזה', [dept[15]]);
    const body = single(id, { all: true });
    expect((await preview(body)).status).toBe(200);
    expect((await preview(body, officerCookie)).status).toBe(403);
    expect((await preview(body, null)).status).toBe(401);
  });

  it('refuses a bad body with a Hebrew message', async () => {
    const response = await preview({ mode: 'single_template', recipients: {} });
    expect(response.status).toBe(400);
    const error = errorOf(response);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toBe(ERROR_MESSAGES.VALIDATION_FAILED);
    expect(error.details?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'recipients',
          code: 'ROUND_RECIPIENTS_REQUIRED',
          message: ERROR_MESSAGES.ROUND_RECIPIENTS_REQUIRED,
        }),
        expect.objectContaining({ field: 'templateId', code: 'ROUND_TEMPLATE_REQUIRED' }),
      ]),
    );
  });

  it('refuses unknown employees, departments and templates (400, count only)', async () => {
    const id = await template('חוזה', [dept[15]]);
    const unknown = '00000000-0000-4000-8000-000000000999';
    const employee = await preview(single(id, { employeeIds: [emp['1001'], unknown] }));
    expect(employee.status).toBe(400);
    expect(errorOf(employee)).toMatchObject({
      code: 'EMPLOYEE_NOT_FOUND',
      details: { field: 'recipients.employeeIds', count: 1 },
    });
    const department = await preview(single(id, { departmentIds: [unknown] }));
    expect(errorOf(department).code).toBe('DEPARTMENT_NOT_FOUND');
    const missingTemplate = await preview(single(unknown, { all: true }));
    expect(missingTemplate.status).toBe(400);
    expect(errorOf(missingTemplate).code).toBe('TEMPLATE_NOT_FOUND');
  });

  it('writes one audit row with counts only, and nothing else', async () => {
    const id = await template('חוזה', [dept[15]]);
    const result = await report(single(id, { all: true }));
    expect(await prisma.round.count()).toBe(0);
    expect(await prisma.assignment.count()).toBe(0);
    const rows = await prisma.auditLog.findMany({
      where: { action: 'round.recipients_previewed' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entityType).toBe('round');
    expect(rows[0]?.details).toMatchObject({
      mode: 'single_template',
      all: true,
      templateIds: [id],
      alreadySigned: 'skip',
      counts: result.counts,
    });
    expect(JSON.stringify(rows[0]?.details)).not.toMatch(/כהן|1001/);
  });
});

describe('recipient choices', () => {
  it.each([
    ['all', { all: true }, 20],
    ['one department', { departmentIds: ['d15'] }, 7],
    ['two departments', { departmentIds: ['d15', 'd19'] }, 13],
    ['hand-picked', { employeeIds: ['1001', '1009'] }, 2],
    ['one employee', { employeeIds: ['1001'] }, 1],
    [
      'department + someone in it + someone outside',
      { departmentIds: ['d15'], employeeIds: ['1001', '1009'] },
      8,
    ],
    [
      'all + department + employee',
      { all: true, departmentIds: ['d61'], employeeIds: ['1001'] },
      20,
    ],
  ])('%s', async (_name, choice, expected) => {
    const id = await template('חוזה', [dept[15]]);
    const recipients = {
      ...('all' in choice && { all: choice.all }),
      ...('departmentIds' in choice && {
        departmentIds: choice.departmentIds.map(
          (key) => dept[Number(key.slice(1)) as 15 | 19 | 61],
        ),
      }),
      ...('employeeIds' in choice && { employeeIds: choice.employeeIds.map((n) => emp[n]) }),
    };
    const { counts } = await report(single(id, recipients));
    expect(counts.recipients).toBe(expected);
    expect(counts.willSendEmail).toBe(expected);
    expect(counts.inRound).toBe(expected);
  });

  it('counts inactive employees from a department, and names an inactive one picked by hand', async () => {
    const id = await template('חוזה', [dept[15]]);
    const inDept15 = await prisma.employee.findFirstOrThrow({
      where: { departmentId: dept[15] },
      orderBy: { employeeNumber: 'asc' },
    });
    const inDept19 = await prisma.employee.findFirstOrThrow({
      where: { departmentId: dept[19] },
      orderBy: { employeeNumber: 'asc' },
    });
    await prisma.employee.updateMany({
      where: { id: { in: [inDept15.id, inDept19.id] } },
      data: { isActive: false },
    });
    const result = await report(
      single(id, { departmentIds: [dept[15]], employeeIds: [inDept19.id] }),
    );
    expect(result.counts).toMatchObject({ recipients: 8, inactive: 2, inRound: 6 });
    expect(numbersOf(result.lists.inactivePicked)).toEqual([inDept19.employeeNumber]);
  });
});

describe('email and missing data', () => {
  it('gives no email for a missing, invalid or bounced email, with the reason only', async () => {
    const id = await template('חוזה', [dept[15]]);
    const states = { '1001': 'missing', '1002': 'invalid', '1003': 'bounced' } as const;
    for (const [number, emailStatus] of Object.entries(states)) {
      await prisma.employee.update({
        where: { employeeNumber: number },
        data: { emailStatus, ...(emailStatus === 'missing' && { email: null }) },
      });
    }
    const ids = Object.keys(states).map((n) => emp[n]);
    const result = await report(single(id, { employeeIds: ids }));
    expect(result.counts).toMatchObject({ noEmail: 3, willSendEmail: 0 });
    expect(
      result.lists.noEmail.items.map(({ employeeNumber, reason }) => [employeeNumber, reason]),
    ).toEqual([
      ['1001', 'missing'],
      ['1002', 'invalid'],
      ['1003', 'bounced'],
    ]);
    expect(JSON.stringify(result)).not.toContain('someone@example.com');
  });

  it('lists a missing address; an empty optional landline is fine; missing wins over no email', async () => {
    const id = await template('חוזה עם כתובת', [dept[15]], READY_FIELDS);
    await prisma.employee.updateMany({ data: { landline: null } });
    await prisma.employee.update({
      where: { employeeNumber: '1001' },
      data: { address: null, city: null },
    });
    await prisma.employee.update({
      where: { employeeNumber: '1002' },
      data: { address: null, city: null, email: null, emailStatus: 'missing' },
    });
    const result = await report(single(id, { departmentIds: [dept[15]] }));
    expect(result.counts).toMatchObject({ missingData: 2, noEmail: 0, willSendEmail: 5 });
    expect(result.lists.missingData.items).toEqual([
      expect.objectContaining({
        employeeNumber: '1001',
        missing: [{ key: 'address', name: 'כתובת' }],
      }),
      expect.objectContaining({
        employeeNumber: '1002',
        missing: [{ key: 'address', name: 'כתובת' }],
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('הרב קוק');
  });

  it('does not count an empty address the employee may fill in', async () => {
    const fields = READY_FIELDS.map((spec) =>
      spec.fieldType === 'address'
        ? { ...spec, fillMode: 'system_then_employee', label: 'כתובת' }
        : spec,
    );
    const id = await template('חוזה', [dept[15]], fields);
    await prisma.employee.update({
      where: { employeeNumber: '1001' },
      data: { address: null, city: null },
    });
    const result = await report(single(id, { employeeIds: [emp['1001']] }));
    expect(result.counts).toMatchObject({ missingData: 0, willSendEmail: 1 });
  });

  it('warns about text too long or with unsupported characters by box and employee, never the value', async () => {
    const id = await template('חוזה עם כתובת', [dept[15]], READY_FIELDS);
    const longAddress = 'רחוב הרב שלמה זלמן אויערבך פינת שדרות גולדה מאיר קומה שלישית דירה 12';
    await prisma.employee.update({
      where: { employeeNumber: '1001' },
      data: { address: longAddress, lastName: 'כהן ب' },
    });
    const result = await report(single(id, { employeeIds: [emp['1001'], emp['1002']] }));
    expect(result.counts.willSendEmail).toBe(2);
    expect(result.lists.textWarnings.items).toEqual([
      expect.objectContaining({
        employeeNumber: '1001',
        warnings: [
          expect.objectContaining({
            code: 'TEXT_TOO_LONG',
            keys: [{ key: 'address', name: 'כתובת' }],
          }),
          expect.objectContaining({
            code: 'CHARACTERS_NOT_SUPPORTED',
            keys: [{ key: 'full_name', name: 'שם מלא' }],
          }),
        ],
      }),
    ]);
    // The row names the employee; the warnings name boxes only, never what is in them.
    expect(JSON.stringify(result)).not.toContain('אויערבך');
    const warnings = JSON.stringify(result.lists.textWarnings.items[0]?.warnings);
    expect(warnings).not.toContain('ب');
    expect(warnings).not.toContain('כהן');
  });
});

describe('templates by department', () => {
  it('uses one, warns about none, asks to choose between two, and hides the unusable ones', async () => {
    const for15 = await template('חוזה ירושלים', [dept[15]]);
    const first19 = await template('חוזה חינוך מיוחד', [dept[19]]);
    const second19 = await template('חוזה צהרון', [dept[19]]);
    const notReady = await template('חוזה אלעד', [dept[61]], NOT_READY);
    const waitsForImage = await template('חוזה אלעד חתום', [dept[61]], PRE_SIGNED, 'pre_signed');

    const body = { mode: 'by_department', recipients: { all: true } };
    const before = await report(body);
    expect(before.canCreate).toBe(false);
    expect(before.departments.map(({ code, status }) => [code, status])).toEqual([
      [15, 'ready'],
      [19, 'choice_needed'],
      [61, 'no_template'],
    ]);
    expect(before.departments[0]?.template?.id).toBe(for15);
    expect(before.departments[1]?.options.map(({ id }) => id).sort()).toEqual(
      [first19, second19].sort(),
    );
    const notOffered = before.departments[2]?.notOffered ?? [];
    expect(notOffered.find(({ id }) => id === notReady)?.reasons.map(({ code }) => code)).toEqual([
      'NO_MAIN_SIGNATURE',
    ]);
    expect(
      notOffered.find(({ id }) => id === waitsForImage)?.reasons.map(({ code }) => code),
    ).toEqual(['EMPLOYER_SIGNATURE_IMAGE_MISSING']);
    expect(before.blockers.map(({ code, departmentId }) => [code, departmentId])).toEqual([
      ['DEPARTMENT_TEMPLATE_CHOICE_NEEDED', dept[19]],
    ]);
    expect(before.warnings.map(({ code, departmentId }) => [code, departmentId])).toEqual([
      ['DEPARTMENT_HAS_NO_TEMPLATE', dept[61]],
    ]);
    expect(before.counts).toMatchObject({
      recipients: 20,
      willSendEmail: 7,
      waitingForChoice: 6,
      noTemplate: 7,
    });

    const after = await report({
      ...body,
      departmentTemplates: [{ departmentId: dept[19], templateId: second19 }],
    });
    expect(after.canCreate).toBe(true);
    expect(after.departments[1]).toMatchObject({ status: 'ready', template: { id: second19 } });
    expect(after.counts).toMatchObject({ willSendEmail: 13, waitingForChoice: 0, noTemplate: 7 });

    // Once the image is uploaded, the waiting template is offered.
    const upload = await server()
      .post('/api/settings/employer-signature')
      .set('Cookie', managerCookie)
      .attach('file', testPng(), 'חתימה.png');
    expect(upload.status).toBe(201);
    const withImage = await report(body);
    expect(withImage.departments[2]).toMatchObject({
      status: 'ready',
      template: { id: waitsForImage },
    });
  });

  it('refuses a choice that is not one of the department templates', async () => {
    await template('חוזה חינוך מיוחד', [dept[19]]);
    const other = await template('חוזה ירושלים', [dept[15]]);
    const result = await report({
      mode: 'by_department',
      departmentTemplates: [{ departmentId: dept[19], templateId: other }],
      recipients: { departmentIds: [dept[19]] },
    });
    expect(result.canCreate).toBe(false);
    expect(result.blockers.map(({ code }) => code)).toEqual(['DEPARTMENT_TEMPLATE_CHOICE_INVALID']);
  });

  it('blocks a single template that is archived or not ready', async () => {
    const archived = await template('חוזה', [dept[15]]);
    await prisma.template.update({ where: { id: archived }, data: { isArchived: true } });
    const result = await report(single(archived, { all: true }));
    expect(result.canCreate).toBe(false);
    expect(result.blockers.map(({ code }) => code)).toEqual(['TEMPLATE_NOT_ACTIVE']);
    expect(result.counts.willSendEmail).toBe(20);

    const waits = await template('חוזה חתום', [dept[15]], PRE_SIGNED, 'pre_signed');
    const blocked = await report(single(waits, { all: true }));
    expect(blocked.blockers).toEqual([
      expect.objectContaining({
        code: 'TEMPLATE_NOT_READY',
        reasons: [expect.objectContaining({ code: 'EMPLOYER_SIGNATURE_IMAGE_MISSING' })],
      }),
    ]);
  });
});

describe('earlier rounds of the same document', () => {
  it('finds a signature on an earlier version, digital or on paper; skip or send again', async () => {
    const v1 = await template('חוזה', [dept[15]]);
    await earlierRound(v1, ['1001'], 'signed', { status: 'closed', name: 'חוזה 2026' });
    await earlierRound(v1, ['1002'], 'signed_manual');
    await prisma.template.update({ where: { id: v1 }, data: { isLocked: true } });
    const patched = await server()
      .patch(`/api/templates/${v1}`)
      .set('Cookie', managerCookie)
      .send({ name: 'חוזה מעודכן' });
    const v2 = templateItemSchema.parse(patched.body);
    expect(v2.version).toBe(2);
    // Another document signed doesn't count.
    const other = await template('מסמך אחר', [dept[15]]);
    await earlierRound(other, ['1003'], 'signed');

    const skip = await report(single(v2.id, { departmentIds: [dept[15]] }));
    expect(skip.counts).toMatchObject({ alreadySigned: 2, inRound: 5, recipients: 7 });
    expect(
      skip.lists.alreadySigned.items.map((item) => [
        item.employeeNumber,
        item.roundName,
        item.templateVersion,
        item.signMethod,
      ]),
    ).toEqual([
      ['1001', 'חוזה 2026', 1, 'digital'],
      ['1002', 'סבב קודם', 1, 'manual'],
    ]);

    const again = await report(
      single(v2.id, { departmentIds: [dept[15]] }, { alreadySigned: 'send_again' }),
    );
    expect(again.counts).toMatchObject({ alreadySigned: 2, inRound: 7, willSendEmail: 7 });
  });

  it('leaves out an open assignment in an active round, not a closed one or an expired link', async () => {
    const id = await template('חוזה', [dept[15]]);
    await earlierRound(id, ['1001'], 'sent', { name: 'סבב פתוח' });
    await earlierRound(id, ['1002'], 'no_email');
    await earlierRound(id, ['1003'], 'sent', { status: 'closed' });
    await earlierRound(id, ['1004'], 'opened', { linkExpiresAt: new Date(Date.now() - 60_000) });
    await earlierRound(id, ['1005'], 'cancelled');
    const result = await report(single(id, { departmentIds: [dept[15]] }));
    expect(result.counts).toMatchObject({ alreadyOpen: 2, inRound: 5 });
    expect(
      result.lists.alreadyOpen.items.map(({ employeeNumber, roundName, status }) => [
        employeeNumber,
        roundName,
        status,
      ]),
    ).toEqual([
      ['1001', 'סבב פתוח', 'sent'],
      ['1002', 'סבב קודם', 'no_email'],
    ]);
  });
});
