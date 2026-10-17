import {
  type ApiError,
  type TemplateItem,
  templateItemSchema,
  type TemplatePreviewReport,
  templatePreviewReportSchema,
} from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runSeed } from '../../prisma/run-seed.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { TemplatesService } from '../../src/modules/templates/templates.service.js';
import { type ContractLayout, layout, SUBSTITUTE } from '../fixtures/contracts.js';
import { PAGE, testPdf } from '../fixtures/pdf.js';
import { readPdfText } from '../fixtures/pdf-text.js';
import { testPng } from '../fixtures/png.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { resetDatabase } from '../setup/database.js';

const seedPassword = 'test-seed-password';

let app: INestApplication;
let prisma: PrismaService;
let managerCookie: string;
let officerCookie: string;
let deptId: string;
/** A seeded employee, given made-up details in `beforeEach`. */
let employeeId: string;

const EMPLOYEE_DETAILS = {
  firstName: 'נועה',
  lastName: 'אבו-חצירא',
  address: 'הרב קוק 12',
  city: 'בני ברק',
  mobile: '052-7654321',
  landline: null,
  birthDate: new Date('1988-03-02T00:00:00.000Z'),
  pensionFundA: null,
  pensionFundB: 'קרן ב לבדיקה',
};

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
  deptId = department.id;
  const employee = await prisma.employee.findFirstOrThrow({ orderBy: { employeeNumber: 'asc' } });
  employeeId = employee.id;
  await prisma.employee.update({ where: { id: employeeId }, data: EMPLOYEE_DETAILS });
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

/** Collects a binary body (supertest leaves non-JSON bodies as a stream by default). */
function binary(req: request.Test): request.Test {
  return req.buffer(true).parse((res, done) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => done(null, Buffer.concat(chunks)));
  });
}

/** Uploads a template with this contract's positions; `pdf` defaults to one A4 page. */
async function contractTemplate(
  contract: ContractLayout,
  pdf?: Buffer,
): Promise<TemplateItem> {
  const created = await server()
    .post('/api/templates')
    .set('Cookie', managerCookie)
    .field('name', `חוזה ${contract.name}`)
    .field('departmentIds', deptId)
    .attach('file', pdf ?? (await testPdf()), 'חוזה.pdf');
  expect(created.status).toBe(201);
  const id = templateItemSchema.parse(created.body).id;
  const patched = await server()
    .patch(`/api/templates/${id}`)
    .set('Cookie', managerCookie)
    .send({
      fields: layout(contract.fields),
      employerSignatureMode: contract.employerSignatureMode,
    });
  expect(patched.status).toBe(200);
  return templateItemSchema.parse(patched.body);
}

async function uploadEmployerSignature(): Promise<void> {
  const response = await server()
    .post('/api/settings/employer-signature')
    .set('Cookie', managerCookie)
    .attach('file', testPng(), 'חתימה.png');
  expect(response.status).toBe(201);
}

function preview(id: string, query: Record<string, string> = {}, cookie: string | null = managerCookie) {
  const req = server().get(`/api/templates/${id}/preview`).query(query);
  if (cookie) req.set('Cookie', cookie);
  return binary(req);
}

function check(id: string, query: Record<string, string> = {}, cookie: string | null = managerCookie) {
  const req = server().get(`/api/templates/${id}/preview/check`).query(query);
  if (cookie) req.set('Cookie', cookie);
  return req;
}

const reportOf = (response: request.Response): TemplatePreviewReport =>
  templatePreviewReportSchema.parse(response.body);
const warningCodes = (report: TemplatePreviewReport) => report.warnings.map(({ code }) => code);

async function auditRows(action: string) {
  return prisma.auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });
}

describe('GET /api/templates/:id/preview', () => {
  it('returns the PDF for a manager: inline, not cached, Hebrew file name', async () => {
    await uploadEmployerSignature();
    const template = await contractTemplate(SUBSTITUTE);
    const response = await preview(template.id);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    const disposition = String(response.headers['content-disposition']);
    expect(disposition).toMatch(/^inline;/);
    expect(disposition).toContain(
      `filename*=UTF-8''${encodeURIComponent('תצוגה מקדימה - חוזה ממלאת מקום.pdf')}`,
    );
    const body = response.body as Buffer;
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    // The made-up sample: a name with a hyphen and a number, both funds (א wins).
    const read = (await readPdfText(body)).map(({ str }) => str);
    expect(read).toEqual(
      expect.arrayContaining(['שירה כהן-לוי 2', '012345674', 'הרב קוק 12, בני ברק', 'קרן פנסיה לדוגמה א']),
    );
  });

  it('draws a real employee from her current details', async () => {
    const template = await contractTemplate(SUBSTITUTE);
    const response = await preview(template.id, { employeeId });
    expect(response.status).toBe(200);
    const read = (await readPdfText(response.body as Buffer)).map(({ str }) => str);
    expect(read).toEqual(expect.arrayContaining(['נועה אבו-חצירא', 'קרן ב לבדיקה']));
  });

  it('403 for an officer, 401 signed out', async () => {
    const template = await contractTemplate(SUBSTITUTE);
    expect((await preview(template.id, {}, officerCookie)).status).toBe(403);
    expect((await preview(template.id, {}, null)).status).toBe(401);
    expect((await check(template.id, {}, officerCookie)).status).toBe(403);
    expect((await check(template.id, {}, null)).status).toBe(401);
  });

  it('logs the view with ids only, never a value', async () => {
    const template = await contractTemplate(SUBSTITUTE);
    await preview(template.id, { employeeId });
    await preview(template.id);
    const rows = await auditRows('template.previewed');
    expect(rows.map(({ entityId, details }) => ({ entityId, details }))).toEqual([
      { entityId: template.id, details: { employeeId } },
      { entityId: template.id, details: { employeeId: null } },
    ]);
    const logged = JSON.stringify(rows.map(({ details }) => details));
    for (const value of ['נועה', 'אבו-חצירא', 'הרב קוק', '052-7654321', 'קרן ב']) {
      expect(logged).not.toContain(value);
    }
  });

  it('404 for an unknown employee or template, 400 for a bad id', async () => {
    const template = await contractTemplate(SUBSTITUTE);
    const unknown = '00000000-0000-4000-8000-000000000000';
    const noEmployee = await preview(template.id, { employeeId: unknown });
    expect(noEmployee.status).toBe(404);
    expect(JSON.parse(String(noEmployee.body))).toMatchObject({
      error: { code: 'EMPLOYEE_NOT_FOUND', message: 'העובד לא נמצא' },
    });
    expect(errorOf(await check(unknown)).code).toBe('NOT_FOUND');
    expect((await check(template.id, { employeeId: 'abc' })).status).toBe(400);
  });

  it('a template with a saved image whose file changed is a clear error, never a wrong image', async () => {
    await uploadEmployerSignature();
    const template = await contractTemplate(SUBSTITUTE);
    const setting = await prisma.setting.findUniqueOrThrow({ where: { key: 'employer_signature' } });
    await prisma.setting.update({
      where: { key: 'employer_signature' },
      data: { value: { ...(setting.value as object), sha256: 'b'.repeat(64) } },
    });
    const response = await preview(template.id);
    expect(response.status).toBe(500);
    expect(JSON.parse(String(response.body))).toMatchObject({
      error: { code: 'EMPLOYER_SIGNATURE_IMAGE_MISMATCH' },
    });
  });

  it('a 20-page template builds in under 2 seconds (PRD §13)', async () => {
    await uploadEmployerSignature();
    const pages = await testPdf({ pages: Array.from({ length: 20 }, () => PAGE.a4) });
    const onEveryPage = Array.from({ length: 20 }, (_, index) => [
      { fieldType: 'full_name', page: index + 1, y: 700 },
      { fieldType: 'address', page: index + 1, y: 600 },
    ]).flat();
    const template = await contractTemplate(
      { ...SUBSTITUTE, fields: [...SUBSTITUTE.fields, ...onEveryPage].slice(0, 40) },
      pages,
    );
    const started = performance.now();
    const response = await preview(template.id, { employeeId });
    const elapsed = performance.now() - started;
    expect(response.status).toBe(200);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('GET /api/templates/:id/preview/check', () => {
  it('the sample is missing nothing and writes no audit row', async () => {
    await uploadEmployerSignature();
    const template = await contractTemplate(SUBSTITUTE);
    const report = reportOf(await check(template.id));
    expect(report).toEqual({ sample: true, missing: [], leftForEmployee: [], warnings: [] });
    expect(await auditRows('template.preview_checked')).toEqual([]);
  });

  it('lists what a real employee is missing (Hebrew names only) and logs ids only', async () => {
    await uploadEmployerSignature();
    await prisma.employee.update({
      where: { id: employeeId },
      data: { address: null, city: null, birthDate: null },
    });
    const template = await contractTemplate(SUBSTITUTE);
    const report = reportOf(await check(template.id, { employeeId }));
    expect(report.missing).toEqual([
      { key: 'address', name: 'כתובת' },
      { key: 'age', name: 'גיל (חסר תאריך לידה)' },
    ]);
    // No landline is fine on the substitute contract (optional position).
    expect(report.missing.map(({ key }) => key)).not.toContain('landline');
    const rows = await auditRows('template.preview_checked');
    expect(rows.map(({ entityId, details }) => ({ entityId, details }))).toEqual([
      { entityId: template.id, details: { employeeId } },
    ]);
  });

  it('an empty address on a system_then_employee box is left for her, not missing', async () => {
    await prisma.employee.update({ where: { id: employeeId }, data: { address: null, city: null } });
    const template = await contractTemplate({
      ...SUBSTITUTE,
      fields: SUBSTITUTE.fields.map((field) =>
        field.fieldType === 'address'
          ? { ...field, fillMode: 'system_then_employee', label: 'כתובת' }
          : field,
      ),
    });
    const report = reportOf(await check(template.id, { employeeId }));
    expect(report.missing).toEqual([]);
    expect(report.leftForEmployee).toEqual([{ key: 'address', name: 'כתובת' }]);
  });

  it('pre_signed with no image yet: a preview with a warning', async () => {
    const template = await contractTemplate(SUBSTITUTE);
    expect(warningCodes(reportOf(await check(template.id)))).toEqual([
      'EMPLOYER_SIGNATURE_IMAGE_MISSING',
    ]);
    expect((await preview(template.id)).status).toBe(200);
  });

  it('a template that is not ready: a preview with each reason as a warning', async () => {
    await uploadEmployerSignature();
    const template = await contractTemplate({
      ...SUBSTITUTE,
      fields: SUBSTITUTE.fields.filter(({ fieldType }) => fieldType !== 'no_email_checkbox'),
    });
    const report = reportOf(await check(template.id));
    // Without the "no email" box: the email section is incomplete, and the signature line
    // shown only for "office" now points to a choice that doesn't exist.
    expect(report.warnings.map(({ code, keys }) => ({ code, keys }))).toEqual([
      { code: 'TEMPLATE_NOT_READY', keys: ['email_input'] },
      { code: 'TEMPLATE_NOT_READY', keys: ['signature'] },
    ]);
    expect(report.warnings[0]?.message).toMatch(/^התבנית עדיין אינה מוכנה לשליחה: /);
    expect((await preview(template.id)).status).toBe(200);
  });

  it('archived or an old version: a preview with a warning', async () => {
    await uploadEmployerSignature();
    const template = await contractTemplate(SUBSTITUTE);
    await app.get(TemplatesService).lockTemplate(template.id);
    const newer = await server()
      .patch(`/api/templates/${template.id}`)
      .set('Cookie', managerCookie)
      .send({ name: 'חוזה ממלאת מקום 2' });
    expect(newer.status).toBe(200);
    expect(warningCodes(reportOf(await check(template.id)))).toEqual(['TEMPLATE_OLD_VERSION']);

    const latest = templateItemSchema.parse(newer.body);
    await server().post(`/api/templates/${latest.id}/archive`).set('Cookie', managerCookie);
    expect(warningCodes(reportOf(await check(latest.id)))).toEqual(['TEMPLATE_ARCHIVED']);
    expect((await preview(latest.id)).status).toBe(200);
  });

  it('an inactive employee: a preview with a warning', async () => {
    await uploadEmployerSignature();
    await prisma.employee.update({ where: { id: employeeId }, data: { isActive: false } });
    const template = await contractTemplate(SUBSTITUTE);
    expect(warningCodes(reportOf(await check(template.id, { employeeId })))).toEqual([
      'EMPLOYEE_INACTIVE',
    ]);
    expect((await preview(template.id, { employeeId })).status).toBe(200);
  });

  it('text that does not fit and characters the font lacks are warnings with the box key', async () => {
    await uploadEmployerSignature();
    await prisma.employee.update({
      where: { id: employeeId },
      data: { address: 'רחוב 😀 ארוך מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד' },
    });
    const narrow = SUBSTITUTE.fields.map((field) =>
      field.fieldType === 'address' ? { ...field, width: 40 } : field,
    );
    const template = await contractTemplate({ ...SUBSTITUTE, fields: narrow });
    const report = reportOf(await check(template.id, { employeeId }));
    expect(report.warnings.map(({ code, keys }) => ({ code, keys }))).toEqual([
      { code: 'TEXT_TOO_LONG', keys: ['address'] },
      { code: 'CHARACTERS_NOT_SUPPORTED', keys: ['address'] },
    ]);
    expect(JSON.stringify(report)).not.toContain('רחוב');
    expect((await preview(template.id, { employeeId })).status).toBe(200);
  });
});
